import assert from "node:assert/strict";
import test from "node:test";

import {
  BoardError,
  buildFieldMutation,
  fieldValue,
  findField,
  findOption,
  normalizeName,
  parseArgs,
  parseItemRef,
  run,
  withRetry,
} from "../skills/end-session/board.mjs";

// A board held in memory, answering the script's queries and mutations by their operation names.
function fakeBoard() {
  const project = {
    id: "PVT_1",
    title: "Example",
    number: 7,
    fields: [
      { id: "F_title", name: "Title", dataType: "TITLE" },
      {
        id: "F_status",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "o_todo", name: "Todo" },
          { id: "o_prog", name: "In Progress" },
          { id: "o_done", name: "Done" },
        ],
      },
      {
        id: "F_prio",
        name: "Priority",
        dataType: "SINGLE_SELECT",
        options: [
          { id: "o_p1", name: "P1 — Now" },
          { id: "o_p2", name: "P2 - Soon" },
        ],
      },
      { id: "F_blocked", name: "Blocked by", dataType: "TEXT" },
      { id: "F_due", name: "Due", dataType: "DATE" },
      { id: "F_size", name: "Size", dataType: "NUMBER" },
    ],
  };
  const fieldById = Object.fromEntries(project.fields.map((field) => [field.id, field]));
  const contents = {
    "acme/app#1": { id: "I_1", type: "Issue", state: "OPEN", items: ["PVTI_1"] },
    "acme/app#2": { id: "I_2", type: "Issue", state: "CLOSED", items: ["PVTI_2"] },
    "acme/app#3": { id: "I_3", type: "Issue", state: "OPEN", items: [] },
    "acme/app#4": { id: "PR_4", type: "PullRequest", state: "MERGED", items: ["PVTI_4"] },
    "acme/app#5": { id: "I_5", type: "Issue", state: "OPEN", items: ["PVTI_5"] },
  };
  const items = {
    PVTI_1: { content: "acme/app#1", values: { Status: "In Progress", Priority: "P2 - Soon" } },
    PVTI_2: { content: "acme/app#2", values: { Status: "Todo" } },
    PVTI_4: { content: "acme/app#4", values: {} },
    PVTI_5: { content: "acme/app#5", values: { Status: "Done" } },
    PVTI_draft: { content: null, title: "An idea", values: { Status: "Todo" } },
  };
  const calls = [];
  let failMutation = null;
  let dropWrites = false;

  const itemNode = (id) => {
    const item = items[id];
    const key = item.content;
    const content = key
      ? {
          __typename: contents[key].type,
          number: Number(key.split("#")[1]),
          state: contents[key].state,
          url: `https://github.com/${key.replace("#", contents[key].type === "Issue" ? "/issues/" : "/pull/")}`,
          repository: { nameWithOwner: key.split("#")[0] },
        }
      : { __typename: "DraftIssue", title: item.title };
    const values = Object.entries(item.values).map(([name, value]) => {
      const field = project.fields.find((candidate) => candidate.name === name);
      const node = { field: { name } };
      if (field.dataType === "SINGLE_SELECT") return { ...node, name: value, optionId: "x" };
      if (field.dataType === "TEXT") return { ...node, text: value };
      if (field.dataType === "NUMBER") return { ...node, number: value };
      return { ...node, date: value };
    });
    return {
      id,
      isArchived: false,
      project: { id: project.id },
      content,
      fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldRepositoryValue" }, { text: "t", field: { name: "Title" } }, ...values] },
    };
  };

  function graphql(query, variables) {
    const name = /^(query|mutation) (\w+)/.exec(query)[2];
    calls.push(name);
    if (name === "Project") {
      if (variables.owner !== "acme" || variables.number !== 7) return { repositoryOwner: { projectV2: null } };
      return { repositoryOwner: { projectV2: { ...project, fields: { nodes: [...project.fields, {}] } } } };
    }
    if (name === "Content") {
      const content = contents[`${variables.owner}/${variables.name}#${variables.number}`];
      if (!content) return { repository: { issueOrPullRequest: null } };
      return {
        repository: {
          issueOrPullRequest: {
            __typename: content.type,
            id: content.id,
            projectItems: { nodes: content.items.map((id) => ({ id, isArchived: false, project: { id: project.id } })) },
          },
        },
      };
    }
    if (name === "Item") return { node: items[variables.id] ? itemNode(variables.id) : null };
    if (name === "Items") {
      return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: Object.keys(items).map(itemNode) } } };
    }
    if (name === "OpenIssues") {
      const open = Object.entries(contents).filter(([, content]) => content.type === "Issue" && content.state === "OPEN");
      return {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: open.map(([key, content]) => ({
              number: Number(key.split("#")[1]),
              title: key,
              url: `https://github.com/${key}`,
              projectItems: { nodes: content.items.map(() => ({ project: { id: project.id } })) },
            })),
          },
        },
      };
    }
    if (name === "Add") {
      const key = Object.keys(contents).find((candidate) => contents[candidate].id === variables.content);
      const id = `PVTI_new_${key.split("#")[1]}`;
      items[id] = { content: key, values: {} };
      contents[key].items.push(id);
      return { addProjectV2ItemById: { item: { id } } };
    }
    if (name === "Fields") {
      if (failMutation) {
        const error = failMutation.shift();
        if (error) throw error;
      }
      const updates = [...query.matchAll(/itemId: "([^"]+)", fieldId: "([^"]+)"(?:, value: \{ (\w+): ([^}]+) \})?/g)];
      for (const [, itemId, fieldId, key, raw] of updates) {
        if (dropWrites) continue;
        const field = fieldById[fieldId];
        if (!key) {
          delete items[itemId].values[field.name];
          continue;
        }
        const value = JSON.parse(raw.trim());
        items[itemId].values[field.name] =
          key === "singleSelectOptionId" ? field.options.find((option) => option.id === value).name : value;
      }
      return {};
    }
    throw new Error(`unexpected operation ${name}`);
  }

  return {
    graphql,
    calls,
    items,
    failNextMutationWith: (...errors) => {
      failMutation = errors;
    },
    dropWrites: () => {
      dropWrites = true;
    },
  };
}

const board = ["--board", "acme 7"];
const noSleep = () => {};

test("parseArgs reads each command and refuses what does not fit it", () => {
  const options = parseArgs(["set", ...board, "--item", "acme/app#1", "--set", "Status=Done", "--set", "Blocked by="]);
  assert.deepEqual(options.board, { owner: "acme", number: 7 });
  assert.deepEqual(options.item, { owner: "acme", name: "app", number: 1 });
  assert.deepEqual(options.sets, [
    { field: "Status", value: "Done" },
    { field: "Blocked by", value: "" },
  ]);
  assert.throws(() => parseArgs(["move", ...board]), /expected one of/);
  assert.throws(() => parseArgs(["get", "--board", "acme"]), /<owner> <number>/);
  assert.throws(() => parseArgs(["get", ...board]), /needs --item or --item-id/);
  assert.throws(() => parseArgs(["set", ...board, "--item", "acme/app#1"]), /set needs --set/);
  assert.throws(() => parseArgs(["file", ...board, "--item-id", "PVTI_1"]), /draft has no issue/);
  assert.throws(() => parseArgs(["audit", ...board, "--item", "acme/app#1"]), /takes no --item/);
  assert.throws(() => parseArgs(["get", ...board, "--repo", "acme/app", "--item", "acme/app#1"]), /only audit/);
  assert.throws(() => parseArgs(["set", ...board, "--item", "acme/app#1", "--set", "Status"]), /<Field>=<value>/);
  assert.throws(() => parseArgs(["get", ...board, "--item"]), /requires a value/);
});

test("an item is named as owner/name#N or by its issue or pull request URL", () => {
  const expected = { owner: "acme", name: "my.app", number: 12 };
  assert.deepEqual(parseItemRef("acme/my.app#12"), expected);
  assert.deepEqual(parseItemRef("https://github.com/acme/my.app/issues/12"), expected);
  assert.deepEqual(parseItemRef("https://github.com/acme/my.app/pull/12/"), expected);
  assert.throws(() => parseItemRef("#12"), BoardError);
});

test("names match whatever the case, spacing or kind of dash", () => {
  assert.equal(normalizeName("  P1 —  Now "), "p1 - now");
  assert.equal(normalizeName("P1 - Now"), "p1 - now");
  const fields = [{ name: "Blocked by" }, { name: "Status" }];
  assert.equal(findField(fields, "blocked BY").name, "Blocked by");
  assert.throws(() => findField(fields, "Stage"), /no field "Stage".*Blocked by, Status/);
});

test("an option is found by its name or by a unique prefix", () => {
  const field = {
    name: "Priority",
    options: [
      { id: "a", name: "P1 — Now" },
      { id: "b", name: "P2 - Soon" },
      { id: "c", name: "P2 later" },
      { id: "d", name: "Done" },
    ],
  };
  assert.equal(findOption(field, "p1 - now").id, "a");
  assert.equal(findOption(field, "P1").id, "a");
  assert.equal(findOption(field, "done").id, "d");
  assert.throws(() => findOption(field, "P2"), /more than one Priority option: P2 - Soon, P2 later/);
  assert.throws(() => findOption(field, "P3"), /not a Priority option/);
});

test("each field type takes its own kind of value, and built-ins are refused", () => {
  const select = { name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o", name: "Done" }] };
  assert.deepEqual(fieldValue(select, "Done"), { singleSelectOptionId: "o" });
  assert.equal(fieldValue(select, ""), null);
  assert.deepEqual(fieldValue({ name: "Note", dataType: "TEXT" }, "x"), { text: "x" });
  assert.deepEqual(fieldValue({ name: "Size", dataType: "NUMBER" }, "3"), { number: 3 });
  assert.throws(() => fieldValue({ name: "Size", dataType: "NUMBER" }, "big"), /takes a number/);
  assert.deepEqual(fieldValue({ name: "Due", dataType: "DATE" }, "2026-11-21"), { date: "2026-11-21" });
  assert.throws(() => fieldValue({ name: "Due", dataType: "DATE" }, "Nov 21"), /YYYY-MM-DD/);
  assert.throws(() => fieldValue({ name: "Labels", dataType: "LABELS" }, "x"), /labels field/);
});

test("the field mutation writes every field in one request, with a clear for an empty value", () => {
  const mutation = buildFieldMutation("PVT_1", "PVTI_1", [
    { field: { id: "F_status" }, value: { singleSelectOptionId: "o_done" } },
    { field: { id: "F_blocked" }, value: null },
  ]);
  assert.match(mutation, /^mutation Fields/);
  assert.match(mutation, /f0: updateProjectV2ItemFieldValue\(input: \{ projectId: "PVT_1", itemId: "PVTI_1", fieldId: "F_status", value: \{ singleSelectOptionId: "o_done" \} \}\)/);
  assert.match(mutation, /f1: clearProjectV2ItemFieldValue\(input: \{ projectId: "PVT_1", itemId: "PVTI_1", fieldId: "F_blocked" \}\)/);
});

test("fields lists the board's fields and their options", () => {
  const fake = fakeBoard();
  const result = run(["fields", ...board], { graphql: fake.graphql, sleep: noSleep });
  assert.deepEqual(result.board, { title: "Example", owner: "acme", number: 7 });
  const status = result.fields.find((field) => field.name === "Status");
  assert.deepEqual(status, { name: "Status", type: "single_select", writable: true, options: ["Todo", "In Progress", "Done"] });
  assert.equal(result.fields.find((field) => field.name === "Title").writable, false);
});

test("get reads an item from its issue, by id, or reports it absent", () => {
  const fake = fakeBoard();
  const deps = { graphql: fake.graphql, sleep: noSleep };
  const { item } = run(["get", ...board, "--item", "acme/app#1"], deps);
  assert.equal(item.id, "PVTI_1");
  assert.equal(item.state, "OPEN");
  assert.deepEqual(item.fields, { Status: "In Progress", Priority: "P2 - Soon" });
  assert.equal(run(["get", ...board, "--item", "acme/app#3"], deps).item, null);
  assert.equal(run(["get", ...board, "--item-id", "PVTI_draft"], deps).item.type, "draft");
  assert.equal(fake.calls.includes("Items"), false, "never reads the item list");
  assert.throws(() => run(["get", ...board, "--item", "acme/app#99"], deps), /no issue or pull request acme\/app#99/);
  assert.throws(() => run(["get", "--board", "acme 8", "--item", "acme/app#1"], deps), /no project 8 owned by acme/);
});

test("set writes only what differs, in one mutation, and reads it back", () => {
  const fake = fakeBoard();
  const result = run(
    ["set", ...board, "--item", "acme/app#1", "--set", "status=done", "--set", "Priority=P2", "--set", "Blocked by=#9", "--set", "Due=2026-12-01", "--set", "Size=3"],
    { graphql: fake.graphql, sleep: noSleep },
  );
  assert.deepEqual(result.changed, [
    { field: "Status", from: "In Progress", to: "Done" },
    { field: "Blocked by", from: null, to: "#9" },
    { field: "Due", from: null, to: "2026-12-01" },
    { field: "Size", from: null, to: 3 },
  ]);
  assert.deepEqual(result.unchanged, ["Priority"]);
  assert.equal(result.added, false);
  assert.equal(fake.calls.filter((name) => name === "Fields").length, 1);
  assert.deepEqual(fake.items.PVTI_1.values, { Status: "Done", Priority: "P2 - Soon", "Blocked by": "#9", Due: "2026-12-01", Size: 3 });
});

test("set with nothing to change sends no mutation, and an empty value clears", () => {
  const fake = fakeBoard();
  const deps = { graphql: fake.graphql, sleep: noSleep };
  const same = run(["set", ...board, "--item", "acme/app#5", "--set", "Status=Done"], deps);
  assert.deepEqual(same.changed, []);
  assert.equal(fake.calls.includes("Fields"), false);
  const cleared = run(["set", ...board, "--item", "acme/app#1", "--set", "Priority="], deps);
  assert.deepEqual(cleared.changed, [{ field: "Priority", from: "P2 - Soon", to: null }]);
  assert.equal("Priority" in fake.items.PVTI_1.values, false);
});

test("set refuses an item not on the board, and file adds it", () => {
  const fake = fakeBoard();
  const deps = { graphql: fake.graphql, sleep: noSleep };
  assert.throws(() => run(["set", ...board, "--item", "acme/app#3", "--set", "Status=Todo"], deps), /not on the board; file adds it/);
  const filed = run(["file", ...board, "--item", "acme/app#3", "--set", "Status=Todo"], deps);
  assert.equal(filed.added, true);
  assert.equal(filed.item.id, "PVTI_new_3");
  assert.deepEqual(filed.item.fields, { Status: "Todo" });
  const again = run(["file", ...board, "--item", "acme/app#3", "--set", "Status=Todo"], deps);
  assert.equal(again.added, false, "filing twice adds nothing");
  assert.deepEqual(again.changed, []);
});

test("a write the board did not take is an error, not a success", () => {
  const fake = fakeBoard();
  fake.dropWrites();
  assert.throws(
    () => run(["set", ...board, "--item", "acme/app#1", "--set", "Status=Done"], { graphql: fake.graphql, sleep: noSleep }),
    /did not take Status=Done/,
  );
});

test("a bad value is refused before anything is written", () => {
  const fake = fakeBoard();
  const deps = { graphql: fake.graphql, sleep: noSleep };
  assert.throws(() => run(["set", ...board, "--item", "acme/app#1", "--set", "Status=Shipped"], deps), /not a Status option/);
  assert.throws(() => run(["set", ...board, "--item", "acme/app#1", "--set", "Title=x"], deps), /title field/);
  assert.equal(fake.calls.includes("Fields"), false);
});

test("a rate limit or server error is retried; any other error is not", () => {
  const limited = Object.assign(new BoardError("was submitted too quickly"), { retryable: true });
  const fake = fakeBoard();
  fake.failNextMutationWith(limited, limited);
  const pauses = [];
  const result = run(["set", ...board, "--item", "acme/app#2", "--set", "Status=Done"], {
    graphql: fake.graphql,
    sleep: (ms) => pauses.push(ms),
  });
  assert.deepEqual(result.changed, [{ field: "Status", from: "Todo", to: "Done" }]);
  assert.deepEqual(pauses, [2000, 5000]);

  let attempts = 0;
  assert.throws(
    () =>
      withRetry(() => {
        attempts += 1;
        throw new BoardError("Could not resolve to a node");
      }, noSleep),
    /Could not resolve/,
  );
  assert.equal(attempts, 1);

  attempts = 0;
  assert.throws(
    () =>
      withRetry(() => {
        attempts += 1;
        throw limited;
      }, noSleep),
    /too quickly/,
  );
  assert.equal(attempts, 4, "three retries, then the error");
});

test("audit finds closed work not Done, open work marked Done, and open issues off the board", () => {
  const fake = fakeBoard();
  const result = run(["audit", ...board, "--repo", "acme/app"], { graphql: fake.graphql, sleep: noSleep });
  assert.equal(result.items, 5);
  assert.deepEqual(
    result.closedNotDone.map((item) => [item.number, item.status]),
    [
      [2, "Todo"],
      [4, null],
    ],
  );
  assert.deepEqual(
    result.openDone.map((item) => item.number),
    [5],
  );
  assert.deepEqual(
    result.noStatus.map((item) => item.number),
    [4],
  );
  assert.deepEqual(
    result.missing.map((issue) => issue.number),
    [3],
  );
  const withoutRepos = run(["audit", ...board], { graphql: fake.graphql, sleep: noSleep });
  assert.equal("missing" in withoutRepos, false);
  assert.throws(() => run(["audit", ...board, "--status-field", "Stage"], { graphql: fake.graphql, sleep: noSleep }), /no field "Stage"/);
});
