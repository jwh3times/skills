import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findKey,
  formatConfig,
  formatTimestamp,
  parseArgs,
  parseConfig,
  pickName,
  proposeConfig,
  readConfig,
  run,
  updateMap,
} from "../skills/handoff/handoff-map.mjs";

const sampleMap = () => ({
  FileName: "handoff_map.json",
  Last_Updated: "09-15-2026 13:54:25",
  Active_Handoffs: { ApexRacers: null, "vcs-lab": "vcs-lab-handoff-2026-09-15.md" },
});
const now = () => new Date(2026, 9, 26, 14, 5, 9);

function tempDir(context, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `handoff-map-${label}-`));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeMapFile(dir, map = sampleMap()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "handoff_map.json"), `${JSON.stringify(map, null, 2)}\n`);
}

const readMapFile = (dir) => JSON.parse(readFileSync(path.join(dir, "handoff_map.json"), "utf8"));

// A stand-in for the proton-drive CLI whose cloud folder is a local directory. `afterUpload` runs
// after each upload, to imitate another session writing the map in between.
function fakeCli(cloudDir, { afterUpload = () => {}, loggedOut = false } = {}) {
  const calls = [];
  const summary = (fields) =>
    JSON.stringify({
      transferredItems: 0,
      transferredBytes: 0,
      skippedItems: 0,
      failedItems: 0,
      failures: [],
      ...fields,
    });
  const cli = (args) => {
    calls.push(args);
    if (loggedOut) return { status: 1, stdout: "", stderr: "You need to login first\n" };
    const [, command] = args;
    const positional = args
      .slice(2)
      .filter((arg, index, all) => !arg.startsWith("-") && all[index - 1] !== "-f");
    if (command === "download") {
      const [remote, into] = positional;
      const source = path.join(cloudDir, path.basename(remote));
      if (!existsSync(source))
        return {
          status: 1,
          stdout: `${summary({})}\n`,
          stderr: `Node not found: ${path.basename(remote)}\n`,
        };
      copyFileSync(source, path.join(into, path.basename(remote)));
      return { status: 0, stdout: `${summary({ transferredItems: 1 })}\n`, stderr: "" };
    }
    if (command === "upload") {
      const locals = positional.slice(0, -1);
      let transferred = 0;
      let skipped = 0;
      for (const local of locals) {
        const target = path.join(cloudDir, path.basename(local));
        if (existsSync(target) && readFileSync(target, "utf8") === readFileSync(local, "utf8"))
          skipped += 1;
        else {
          copyFileSync(local, target);
          transferred += 1;
        }
      }
      afterUpload(locals.map((local) => path.basename(local)));
      return {
        status: 0,
        stdout: `${summary({ transferredItems: transferred, skippedItems: skipped })}\n`,
        stderr: "",
      };
    }
    if (command === "list") {
      return {
        status: 0,
        stdout: JSON.stringify(
          readdirSync(cloudDir).map((name) => ({ name: { ok: true, value: name }, type: "file" })),
        ),
        stderr: "",
      };
    }
    throw new Error(`unexpected proton-drive call: ${args.join(" ")}`);
  };
  return { cli, calls };
}

function folderSetup(context) {
  const dir = tempDir(context, "folder");
  writeMapFile(dir);
  const env = { HANDOFFS_TRANSPORT: "folder", HANDOFFS_DIR: dir };
  return { dir, deps: { env, home: dir, now, read: () => null } };
}

function cliSetup(context, options) {
  const cloud = tempDir(context, "cloud");
  const mirror = path.join(tempDir(context, "mirror"), "Handoffs");
  writeMapFile(cloud);
  const fake = fakeCli(cloud, options);
  const env = { HANDOFFS_TRANSPORT: "proton-cli", HANDOFFS_DIR: mirror };
  return {
    cloud,
    mirror,
    calls: fake.calls,
    deps: { env, home: mirror, now, cli: fake.cli, read: () => null },
  };
}

const exec = (argv, deps) => run(parseArgs(argv), deps);

test("parseArgs requires a key, a bare file name, and --expect for clear", () => {
  assert.equal(parseArgs(["get", "--key", "ApexRacers"]).key, "ApexRacers");
  assert.equal(parseArgs(["set", "a.md", "--key", "x"]).file, "a.md");
  assert.equal(parseArgs(["config", "--write", "--transport", "folder"]).write, true);
  assert.throws(() => parseArgs([]), /expected one of/u);
  assert.throws(() => parseArgs(["get"]), /needs --key/u);
  assert.throws(() => parseArgs(["set", "--key", "x"]), /needs the handoff file name/u);
  assert.throws(() => parseArgs(["set", "sub/a.md", "--key", "x"]), /not a path/u);
  assert.throws(() => parseArgs(["clear", "--key", "x"]), /needs --expect/u);
  assert.throws(() => parseArgs(["name", "--key", "x", "--topic", "Two Words"]), /lowercase slug/u);
  assert.throws(() => parseArgs(["get", "--key", "x", "extra"]), /unknown argument/u);
});

test("keys match case- and punctuation-insensitively and keep the map's spelling", () => {
  const active = { ApexRacers: null, GuardianTracker: "g.md", "vcs-lab": "v.md" };
  assert.equal(findKey(active, "apexracers"), "ApexRacers");
  assert.equal(findKey(active, "VCS_Lab"), "vcs-lab");
  assert.equal(findKey(active, "leasebook"), null);
  const set = updateMap(sampleMap(), "apexracers", "a.md", now());
  assert.equal(set.key, "ApexRacers");
  assert.equal(set.map.Active_Handoffs.ApexRacers, "a.md");
  assert.equal(set.map.Active_Handoffs["vcs-lab"], "vcs-lab-handoff-2026-09-15.md");
  assert.equal(set.map.Last_Updated, "10-26-2026 14:05:09");
  assert.equal(formatTimestamp(new Date(2026, 8, 5, 7, 3, 9)), "09-05-2026 07:03:09");
});

test("names are <key>-handoff-<date>[-topic].md, numbered when taken", () => {
  assert.equal(pickName("ApexRacers", [], now()), "apexracers-handoff-2026-10-26.md");
  assert.equal(
    pickName("skills", [], now(), "ship-port"),
    "skills-handoff-2026-10-26-ship-port.md",
  );
  assert.equal(
    pickName("skills", ["skills-handoff-2026-10-26.md", "Skills-Handoff-2026-10-26-2.md"], now()),
    "skills-handoff-2026-10-26-3.md",
  );
});

test("machine config: file values, environment over file, ~ expanded, problems named", () => {
  assert.deepEqual(
    parseConfig('# c\nexport HANDOFFS_TRANSPORT=proton-cli\nHANDOFFS_DIR="~/dev/handoffs"\n'),
    {
      HANDOFFS_TRANSPORT: "proton-cli",
      HANDOFFS_DIR: "~/dev/handoffs",
    },
  );
  const read = () => "HANDOFFS_TRANSPORT=proton-cli\nHANDOFFS_DIR=~/dev/handoffs\n";
  const fromFile = readConfig({ env: {}, home: "/h", read });
  assert.equal(fromFile.configured, true);
  assert.equal(fromFile.dir, path.resolve("/h/dev/handoffs"));
  assert.equal(fromFile.remote, "/my-files/Documents/Handoffs");
  assert.equal(
    readConfig({ env: { HANDOFFS_DIR: "/elsewhere" }, home: "/h", read }).dir,
    path.resolve("/elsewhere"),
  );
  assert.equal(
    readConfig({ env: { XDG_CONFIG_HOME: "/x" }, home: "/h", read }).file,
    path.join("/x", "handoffs", "config"),
  );

  const missing = readConfig({ env: { HANDOFFS_DIR: "/d" }, home: "/h", read: () => null });
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.problems, ["HANDOFFS_TRANSPORT is not set"]);
  assert.match(
    readConfig({ env: { HANDOFFS_TRANSPORT: "ftp", HANDOFFS_DIR: "/d" }, read: () => null })
      .problems[0],
    /must be one of/u,
  );
});

test("the proposal prefers a synced folder, then the CLI with an exported HANDOFFS_DIR", () => {
  assert.deepEqual(
    proposeConfig({
      env: {},
      home: "/h",
      synced: ["/h/Proton Drive/a/My files/Documents/Handoffs"],
      hasCli: true,
    }).transport,
    "folder",
  );
  const cli = proposeConfig({
    env: { HANDOFFS_DIR: "/h/dev/handoffs" },
    home: "/h",
    synced: [],
    hasCli: true,
  });
  assert.equal(cli.transport, "proton-cli");
  assert.equal(cli.dir, path.resolve("/h/dev/handoffs"));
  assert.equal(proposeConfig({ env: {}, home: "/h", synced: [], hasCli: false }).dir, null);
  assert.equal(
    formatConfig({ transport: "proton-cli", dir: "/d", remote: null })
      .split("\n")
      .slice(1)
      .join("\n"),
    "HANDOFFS_TRANSPORT=proton-cli\nHANDOFFS_DIR=/d\nHANDOFFS_REMOTE=/my-files/Documents/Handoffs\n",
  );
});

test("config --write writes the file, which then configures the machine", (context) => {
  const home = tempDir(context, "home");
  const env = { HANDOFFS_CONFIG: path.join(home, "cfg", "config") };
  const deps = {
    env,
    home,
    read: (file) => (existsSync(file) ? readFileSync(file, "utf8") : null),
  };
  assert.equal(exec(["config"], deps).configured, false);
  const written = exec(
    ["config", "--write", "--transport", "folder", "--dir", path.join(home, "H")],
    deps,
  );
  assert.equal(written.configured, true);
  assert.equal(written.dir, path.join(home, "H"));
  assert.match(readFileSync(env.HANDOFFS_CONFIG, "utf8"), /^HANDOFFS_TRANSPORT=folder$/mu);
});

test("an unconfigured machine is refused with the way to configure it", () => {
  assert.throws(
    () => exec(["get", "--key", "x"], { env: {}, home: "/h", read: () => null }),
    /no machine config.*config`/u,
  );
});

test("folder transport: set, get and clear round-trip; the map is never created", (context) => {
  const { dir, deps } = folderSetup(context);
  writeFileSync(path.join(dir, "apexracers-handoff-2026-10-26.md"), "# handoff\n");

  assert.throws(() => exec(["set", "missing.md", "--key", "apexracers"], deps), /refusing/u);
  const set = exec(["set", "apexracers-handoff-2026-10-26.md", "--key", "apexracers"], deps);
  assert.equal(set.key, "ApexRacers");
  assert.equal(set.previous, null);
  assert.equal(set.current, "apexracers-handoff-2026-10-26.md");

  const got = exec(["get", "--key", "ApexRacers"], deps);
  assert.equal(got.file, "apexracers-handoff-2026-10-26.md");
  assert.equal(got.exists, true);
  assert.equal(
    exec(["name", "--key", "ApexRacers"], deps).file,
    "apexracers-handoff-2026-10-26-2.md",
  );

  assert.throws(
    () => exec(["clear", "--key", "apexracers", "--expect", "other.md"], deps),
    /refusing to clear ApexRacers/u,
  );
  assert.equal(
    exec(["clear", "--key", "apexracers", "--expect", "apexracers-handoff-2026-10-26.md"], deps)
      .current,
    null,
  );
  assert.equal(readMapFile(dir).Active_Handoffs.ApexRacers, null);
  assert.equal(readMapFile(dir).Active_Handoffs["vcs-lab"], "vcs-lab-handoff-2026-09-15.md");
  assert.ok(!readdirSync(dir).some((name) => name.endsWith(".tmp")));

  const unknown = exec(["get", "--key", "leasebook"], deps);
  assert.equal(unknown.inMap, false);
  assert.equal(unknown.file, null);
  rmSync(path.join(dir, "handoff_map.json"));
  assert.throws(() => exec(["get", "--key", "x"], deps), /never creates one/u);
});

test("folder transport: CRLF maps stay CRLF and conflict copies are reported", (context) => {
  const { dir, deps } = folderSetup(context);
  writeFileSync(
    path.join(dir, "handoff_map.json"),
    `﻿${JSON.stringify(sampleMap(), null, 2).replace(/\n/gu, "\r\n")}\r\n`,
  );
  writeFileSync(path.join(dir, "handoff_map (conflict 1).json"), "{}");
  writeFileSync(path.join(dir, "s.md"), "x");
  const set = exec(["set", "s.md", "--key", "skills"], deps);
  assert.deepEqual(set.conflicts, ["handoff_map (conflict 1).json"]);
  assert.match(
    readFileSync(path.join(dir, "handoff_map.json"), "utf8"),
    /\r\n {2}"Active_Handoffs"/u,
  );
  assert.equal(readMapFile(dir).Active_Handoffs.skills, "s.md");
});

test("proton-cli: set pushes the document before the map and verifies the cloud copy", (context) => {
  const { cloud, mirror, calls, deps } = cliSetup(context);
  const name = exec(["name", "--key", "skills"], deps);
  assert.equal(name.file, "skills-handoff-2026-10-26.md");
  writeFileSync(name.path, "# handoff\n");

  const set = exec(["set", name.file, "--key", "skills"], deps);
  assert.equal(set.verified, "cloud");
  assert.equal(set.attempts, 1);
  assert.equal(readMapFile(cloud).Active_Handoffs.skills, name.file);
  assert.ok(existsSync(path.join(cloud, name.file)));
  const uploads = calls
    .filter((args) => args[1] === "upload")
    .map((args) => path.basename(args.at(-2)));
  assert.deepEqual(uploads, [name.file, "handoff_map.json"]);
  assert.ok(existsSync(path.join(mirror, "handoff_map.json")));
});

test("proton-cli: get fetches a document the mirror lacks, and says when the cloud lacks it too", (context) => {
  const { cloud, mirror, deps } = cliSetup(context);
  writeMapFile(cloud, {
    ...sampleMap(),
    Active_Handoffs: { skills: "skills-handoff-2026-10-25.md", other: "missing.md" },
  });
  writeFileSync(path.join(cloud, "skills-handoff-2026-10-25.md"), "# from the other machine\n");

  const got = exec(["get", "--key", "skills"], deps);
  assert.equal(got.exists, true);
  assert.equal(
    readFileSync(path.join(mirror, "skills-handoff-2026-10-25.md"), "utf8"),
    "# from the other machine\n",
  );

  const absent = exec(["get", "--key", "other"], deps);
  assert.equal(absent.exists, false);
  assert.match(absent.note, /has not pushed it/u);
});

test("proton-cli: name avoids names taken only in the cloud", (context) => {
  const { cloud, deps } = cliSetup(context);
  writeFileSync(path.join(cloud, "skills-handoff-2026-10-26.md"), "taken\n");
  assert.equal(exec(["name", "--key", "skills"], deps).file, "skills-handoff-2026-10-26-2.md");
});

test("proton-cli: a write that loses a race is repeated against the newer map", (context) => {
  let raced = false;
  const { cloud, deps } = cliSetup(context, {
    afterUpload: (names) => {
      if (raced || !names.includes("handoff_map.json")) return;
      raced = true;
      // Another session publishes the map it pulled before ours landed, plus its own entry.
      writeMapFile(cloud, {
        ...sampleMap(),
        Active_Handoffs: { ...sampleMap().Active_Handoffs, skills: "s.md", LeaseBook: "lb.md" },
      });
    },
  });
  writeMapFile(cloud, {
    ...sampleMap(),
    Active_Handoffs: { ...sampleMap().Active_Handoffs, skills: "s.md" },
  });

  const cleared = exec(["clear", "--key", "skills", "--expect", "s.md"], deps);
  assert.equal(cleared.attempts, 2);
  assert.equal(readMapFile(cloud).Active_Handoffs.LeaseBook, "lb.md");
  assert.equal(readMapFile(cloud).Active_Handoffs.skills, null);
});

test("proton-cli: clear refuses when the cloud map names another document", (context) => {
  const { cloud, deps } = cliSetup(context);
  writeMapFile(cloud, { ...sampleMap(), Active_Handoffs: { skills: "newer.md" } });
  assert.throws(
    () => exec(["clear", "--key", "skills", "--expect", "older.md"], deps),
    /names "newer.md", not "older.md"/u,
  );
  assert.equal(readMapFile(cloud).Active_Handoffs.skills, "newer.md");
});

test("proton-cli: a lapsed login is reported as the user's step", (context) => {
  const { deps } = cliSetup(context, { loggedOut: true });
  assert.throws(() => exec(["get", "--key", "skills"], deps), /proton-drive auth login/u);
});

test("push re-sends a document on the CLI mirror and is a no-op on a synced folder", (context) => {
  const { cloud, mirror, deps } = cliSetup(context);
  mkdirSync(mirror, { recursive: true });
  writeFileSync(path.join(mirror, "d.md"), "v2\n");
  assert.equal(exec(["push", "d.md"], deps).pushed, true);
  assert.equal(readFileSync(path.join(cloud, "d.md"), "utf8"), "v2\n");

  const folder = folderSetup(context);
  writeFileSync(path.join(folder.dir, "d.md"), "x");
  assert.equal(exec(["push", "d.md"], folder.deps).pushed, false);
});
