import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(new URL("..", import.meta.url).pathname);
const publicOrigin = "https://adaivo.github.io";
const publicBasePath = "/adaivo-music-legal/";
const historicalRelease = "2026-07-23.1";
const historicalLocales = ["en", "zh-Hans"];
const releaseLocales = ["en", "zh-Hans", "ja", "ko", "zh-Hant-HK"];
const documents = ["licenses", "privacy", "terms"];
const draftStatus = "DRAFT — NOT LEGALLY REVIEWED — NOT APPROVED FOR RELEASE OR PUBLICATION";
const pageChrome = {
  en: { navigation: "Legal documents", canonicalMarkdown: "Canonical Markdown", rights: "All rights reserved." },
  "zh-Hans": { navigation: "法律文件", canonicalMarkdown: "规范 Markdown", rights: "保留所有权利。" },
  ja: { navigation: "法的文書", canonicalMarkdown: "正規 Markdown", rights: "無断転載を禁じます。" },
  ko: { navigation: "법률 문서", canonicalMarkdown: "정식 Markdown", rights: "모든 권리 보유." },
  "zh-Hant-HK": { navigation: "法律文件", canonicalMarkdown: "正式 Markdown", rights: "保留一切權利。" },
};
const required = {
  terms: ["Operator", "Acceptance", "Accounts", "Limited", "Subscriptions", "Catalog", "Intellectual", "Service changes", "Disclaimers", "liability", "Indemnity", "Governing", "Changes", "Severability", "Contact"],
  privacy: ["Operator", "Information", "Purposes", "Providers", "Cross-border", "Retention", "Security", "Access", "Children", "Changes", "Contact"],
  licenses: ["Scope", "Runtime", "Native", "license"]
};
const runtimeInventoryFile = JSON.parse(await readFile(resolve(root, "inventory/runtime-lock-inventory.json"), "utf8"));
assert.equal(runtimeInventoryFile.sourceCommit, "c810e47c83771fafea1366a6a58d4762c553b751");
assert.equal(runtimeInventoryFile.count, 660);
assert.equal(runtimeInventoryFile.entries.length, 660);
const runtimeInventory = runtimeInventoryFile.entries;
const historicalDocumentHashes = {
  "en/terms": "fc738e5f13902d5d1b05765d2aa3fb7fa810d8b6c0da7f75743012ed04853390",
  "en/privacy": "887f5d2986a0da8aa26d620ceb02039db4e2eb15aa6d182178eb4a23fac114bb",
  "en/licenses": "d9963f73b03795493121965823c0b23b8af696d848dad9fbddedb12a834d4e61",
  "zh-Hans/terms": "25ba71ba7399fbebd6a5d8d6b1fdb21f40f02bae306b9007dc8d791ee6f9f73a",
  "zh-Hans/privacy": "d0f326f73a27cb61787518e63b4d53227fae5f1fb444e86905ad4415c26160f6",
  "zh-Hans/licenses": "298906b782d34ef68e525e7ae49b39e8b28eff87bee352d4bd647572ee149793",
};

function metadataArgs() {
  const releaseIndex = process.argv.indexOf("--release");
  const effectiveDateIndex = process.argv.indexOf("--effective-date");
  assert.equal(releaseIndex < 0, effectiveDateIndex < 0, "--release and --effective-date must be supplied together");
  const release = releaseIndex < 0 ? historicalRelease : process.argv[releaseIndex + 1];
  const effectiveDate = effectiveDateIndex < 0 ? "2026-07-23" : process.argv[effectiveDateIndex + 1];
  assert(/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release), "invalid release metadata");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate), "invalid release metadata");
  if (release === historicalRelease) assert.equal(effectiveDate, "2026-07-23", "historical release effective-date must equal 2026-07-23");
  return { release, effectiveDate };
}

export function validateManifestMarkdownUrl(value, release, locale, document) {
  const markdownUrl = new URL(value);
  const expected = `${publicOrigin}${publicBasePath}releases/${release}/${locale}/${document}.md`;
  assert.equal(markdownUrl.protocol, "https:", `${locale}/${document}: manifest Markdown must use HTTPS`);
  assert.equal(markdownUrl.origin, publicOrigin, `${locale}/${document}: manifest Markdown origin mismatch`);
  assert.equal(markdownUrl.pathname, `${publicBasePath}releases/${release}/${locale}/${document}.md`, `${locale}/${document}: manifest Markdown path mismatch`);
  assert.equal(markdownUrl.search, "", `${locale}/${document}: manifest Markdown query forbidden`);
  assert.equal(markdownUrl.hash, "", `${locale}/${document}: manifest Markdown fragment forbidden`);
  assert.equal(markdownUrl.username, "", `${locale}/${document}: manifest Markdown credentials forbidden`);
  assert.equal(markdownUrl.password, "", `${locale}/${document}: manifest Markdown credentials forbidden`);
  assert.equal(markdownUrl.href, expected, `${locale}/${document}: manifest Markdown URL must be exact`);
  return markdownUrl;
}

export function validateManifestRoot(manifest) {
  assert.deepEqual(Object.keys(manifest).sort(), ["documents", "effectiveDate", "generatedFrom", "release", "schemaVersion"], "manifest root fields mismatch");
  assert.equal(manifest.schemaVersion, 1, "manifest schemaVersion must equal 1");
  assert(Number.isInteger(manifest.schemaVersion), "manifest schemaVersion must be an integer");
}

export function validateManifestTopology(manifest) {
  const locales = manifest.release === historicalRelease ? historicalLocales : releaseLocales;
  const expected = locales.flatMap((locale) => documents.map((document) => `${locale}/${document}`)).sort();
  const actual = manifest.documents.map((entry) => `${entry.locale}/${entry.document}`).sort();
  assert.equal(actual.length, expected.length,
    `${manifest.release === historicalRelease ? "historical" : "new"} release document count mismatch`);
  assert.deepEqual(actual, expected, "manifest locale/document topology mismatch");
}

export function validateSource(text, locale, document, release, effectiveDate) {
  assert(text.includes(release), `${locale}/${document}: release mismatch`);
  assert(text.includes(effectiveDate), `${locale}/${document}: effective-date mismatch`);
  assert(!/<\/?[A-Za-z][^>]*>|<script|!\[[^\]]*\]\(/i.test(text), `${locale}/${document}: raw HTML/script/image`);
  assert(!text.includes("`"), `${locale}/${document}: inline code/backticks are unsupported`);
  assert(!/\bUNKNOWN\b/.test(text), `${locale}/${document}: UNKNOWN license entry`);
  if (locale === "en") for (const section of required[document]) assert(text.toLowerCase().includes(section.toLowerCase()), `${locale}/${document}: missing ${section}`);
  if (locale === "zh-Hans") assert(text.includes("英文版本为准"), `${locale}/${document}: missing English-controls clause`);
  for (const match of text.matchAll(/https?:\/\/[^\s)`]+/g)) {
    const url = new URL(match[0]);
    assert.equal(url.protocol, "https:", `${locale}/${document}: non-HTTPS URL`);
    assert(["registry.npmjs.org", "spdx.org", "www.apache.org", "opensource.org", "www.openssl.org"].includes(url.hostname), `${locale}/${document}: URL host not allowlisted`);
  }
  if (document === "licenses") assert(!/Adaivo.{0,50}(is open source|licensed under (the )?(MIT|Apache))/i.test(text), `${locale}/${document}: Adaivo content marked OSS`);
  if (document === "licenses") for (const entry of runtimeInventory) {
    const englishInventory = locale !== "zh-Hans";
    const row = text.split("\n").find((line) => line.includes(englishInventory ? `lock path: ${entry.path};` : `锁路径：${entry.path}；`));
    assert(row, `${locale}/${document}: missing runtime package path ${entry.path}`);
    assert(row.includes(englishInventory ? `package: ${entry.name};` : `软件包：${entry.name}；`), `${locale}/${document}: missing runtime package ${entry.name}`);
    assert(row.includes(englishInventory ? `version: ${entry.version};` : `版本：${entry.version}；`), `${locale}/${document}: missing runtime version ${entry.path}`);
    assert(row.includes(entry.resolved), `${locale}/${document}: missing resolved runtime source ${entry.path}`);
    assert(row.includes(englishInventory ? "repository: Not recorded" : "仓库：未记录"), `${locale}/${document}: missing explicit repository field ${entry.path}`);
    assert(row.includes(englishInventory ? "copyright: Not recorded" : "版权：未记录"), `${locale}/${document}: missing explicit copyright field ${entry.path}`);
    assert(row.includes(englishInventory ? `license: ${entry.license}` : `许可：${entry.license}`), `${locale}/${document}: missing runtime license ${entry.path}`);
    if (entry.patched) assert(row.includes(englishInventory ? "patched locally" : "应用本地补丁"), `${locale}/${document}: missing patched-package disclosure ${entry.path}`);
  }
  if (document === "licenses") {
    const rowPattern = locale !== "zh-Hans" ? /^- package: .*source: https:\/\/registry\.npmjs\.org\//gm : /^- 软件包：.*源链接：https:\/\/registry\.npmjs\.org\//gm;
    assert.equal([...text.matchAll(rowPattern)].length, runtimeInventory.length, `${locale}/${document}: runtime inventory count mismatch`);
  }
}

async function listFiles(base, relative = "") {
  const output = [];
  for (const entry of await readdir(resolve(base, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(base, next));
    else output.push(next);
  }
  return output.sort();
}

async function verifyDeterministicBuild(release, effectiveDate) {
  const isolated = await mkdtemp(resolve(tmpdir(), "adaivo-legal-"));
  try {
    const noticeBuild = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--release", release, "--effective-date", effectiveDate, "--output-dir", isolated], { cwd: root, encoding: "utf8" });
    assert.equal(noticeBuild.status, 0, noticeBuild.stderr);
    const locales = release === historicalRelease ? historicalLocales : releaseLocales;
    for (const locale of locales) {
      const path = `content/${locale}/licenses.md`;
      assert((await readFile(resolve(isolated, path))).equals(await readFile(resolve(root, path))), `generated runtime notice differs: ${path}`);
    }
    const build = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", release, "--effective-date", effectiveDate, "--output-dir", isolated], { cwd: root, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const historicalPaths = release === historicalRelease
      ? []
      : await listFiles(root, `site/releases/${historicalRelease}`);
    if (release !== historicalRelease) {
      assert.deepEqual(historicalPaths, historicalLocales.flatMap((locale) =>
        documents.map((document) => `site/releases/${historicalRelease}/${locale}/${document}.md`),
      ).sort(), 'historical release topology differs');
    }
    const generatedPaths = ["manifest.json", ...await listFiles(isolated, "site")];
    const expectedPaths = [...generatedPaths, ...historicalPaths].sort();
    const actualPaths = ["manifest.json", ...await listFiles(root, "site")];
    assert.deepEqual(actualPaths, expectedPaths, "generated file set differs from isolated rebuild");
    for (const path of generatedPaths) {
      const expected = await readFile(resolve(isolated, path));
      const actual = await readFile(resolve(root, path));
      assert(expected.equals(actual), `generated file differs from isolated rebuild: ${path}`);
    }
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}

async function verify() {
  const { release, effectiveDate } = metadataArgs();
  if (release !== historicalRelease) {
    const policy = spawnSync(process.execPath, [
      "scripts/verify-draft-content.mjs",
      "--root", root,
      "--mode", "release-ready",
      "--release", release,
      "--effective-date", effectiveDate,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(policy.status, 0, policy.stderr || "release_ready_rejected");
  }
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  validateManifestRoot(manifest);
  assert.equal(await readFile(resolve(root, "site/manifest.json"), "utf8"), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(manifest.release, release);
  assert.equal(manifest.effectiveDate, effectiveDate);
  validateManifestTopology(manifest);
  const locales = release === historicalRelease ? historicalLocales : releaseLocales;
  const css = await readFile(resolve(root, "site/assets/legal.css"), "utf8");
  const cssFingerprint = createHash("sha256").update(css).digest("hex").slice(0, 16);
  for (const locale of locales) for (const document of documents) {
    const entry = manifest.documents.find((item) => item.locale === locale && item.document === document);
    assert(entry, `missing ${locale}/${document}`);
    const markdownUrl = validateManifestMarkdownUrl(entry.markdown, release, locale, document);
    const source = await readFile(resolve(root, entry.source), "utf8");
    validateSource(source, locale, document, release, effectiveDate);
    const canonicalPath = markdownUrl.pathname.slice(`${publicBasePath}`.length);
    const canonical = await readFile(resolve(root, "site", canonicalPath));
    assert.equal(canonical.length, entry.bytes, `${locale}/${document}: byte mismatch`);
    assert.equal(createHash("sha256").update(canonical).digest("hex"), entry.sha256, `${locale}/${document}: hash mismatch`);
    if (release === historicalRelease) {
      assert.equal(createHash("sha256").update(canonical).digest("hex"), historicalDocumentHashes[`${locale}/${document}`], `${locale}/${document}: historical immutable hash mismatch`);
    }
    assert.equal(canonical.toString("utf8"), source.replace(/\r\n?/g, "\n").normalize("NFC").replace(/\n?$/, "\n"));
    const page = await readFile(resolve(root, "site", entry.page, "index.html"), "utf8");
    if (release !== historicalRelease) {
      const chrome = pageChrome[locale];
      assert(page.includes(`aria-label="${chrome.navigation}"`), `${locale}/${document}: navigation label mismatch`);
      assert(page.includes(chrome.canonicalMarkdown), `${locale}/${document}: canonical label mismatch`);
      assert(page.includes(chrome.rights), `${locale}/${document}: footer mismatch`);
    }
    assert(page.includes(`href="../../assets/legal.css?v=${cssFingerprint}"`), `${locale}/${document}: stylesheet fingerprint mismatch`);
    assert(page.includes(`../../releases/${release}/${locale}/${document}.md`), `${locale}/${document}: broken canonical link`);
    assert(!/<script|<img|https?:\/\/[^"]+\.(js|css)/i.test(page), `${locale}/${document}: forbidden page asset`);
    if (locale === "zh-Hans" && document === "licenses") for (const entry of runtimeInventory) {
      assert(page.includes(`href="${entry.resolved}"`), `zh-Hans/licenses: malformed generated href for ${entry.path}`);
    }
  }
  const index = await readFile(resolve(root, "site/index.html"), "utf8");
  for (const entry of manifest.documents) assert(index.includes(`href="${entry.page}"`), `broken index link ${entry.page}`);
  assert(index.includes(`href="assets/legal.css?v=${cssFingerprint}"`), "index stylesheet fingerprint mismatch");
  assert(css.includes("main a{overflow-wrap:anywhere;word-break:break-word}"), "main-content links must wrap at narrow viewports");
  assert(css.includes("main li{overflow-wrap:anywhere;word-break:break-word}"), "main-content list text must wrap at narrow viewports");
  await verifyDeterministicBuild(release, effectiveDate);
}

if (process.argv.includes("--self-test")) {
  const validRoot = { schemaVersion: 1, release: "x", effectiveDate: "x", generatedFrom: "x", documents: [] };
  validateManifestRoot(validRoot);
  assert.throws(() => validateManifestRoot({ ...validRoot, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateManifestRoot({ ...validRoot, schemaVersion: 1.5 }), /schemaVersion/);
  const { schemaVersion: omittedSchemaVersion, ...missingSchema } = validRoot;
  assert.throws(() => validateManifestRoot(missingSchema), /root fields/);
  assert.throws(() => validateManifestRoot({ ...validRoot, extra: true }), /root fields/);
  const validManifestUrl = "https://adaivo.github.io/adaivo-music-legal/releases/2026-07-23.1/en/terms.md";
  assert.equal(validateManifestMarkdownUrl(validManifestUrl, "2026-07-23.1", "en", "terms").href, validManifestUrl);
  assert.throws(() => validateManifestMarkdownUrl(validManifestUrl.replace("https:", "http:"), "2026-07-23.1", "en", "terms"), /HTTPS/);
  assert.throws(() => validateManifestMarkdownUrl(validManifestUrl.replace("adaivo.github.io", "example.com"), "2026-07-23.1", "en", "terms"), /origin/);
  assert.throws(() => validateManifestMarkdownUrl(validManifestUrl.replace("/terms.md", "/privacy.md"), "2026-07-23.1", "en", "terms"), /path/);
  assert.throws(() => validateManifestMarkdownUrl(`${validManifestUrl}?download=1`, "2026-07-23.1", "en", "terms"), /query/);
  assert.throws(() => validateManifestMarkdownUrl(`${validManifestUrl}#fragment`, "2026-07-23.1", "en", "terms"), /fragment/);
  assert.throws(() => validateManifestMarkdownUrl(validManifestUrl.replace("https://", "https://user@"), "2026-07-23.1", "en", "terms"), /credentials/);
  assert.throws(() => validateSource("# Scope\n2026-07-23.1 2026-07-23 Runtime Native license UNKNOWN", "en", "licenses", "2026-07-23.1", "2026-07-23"), /UNKNOWN/);
  assert.throws(() => validateSource("# Privacy\n2026-07-23.1 2026-07-23 <script>", "en", "privacy", "2026-07-23.1", "2026-07-23"), /raw HTML/);
  const historicalManifest = {
    ...validRoot,
    release: historicalRelease,
    documents: historicalLocales.flatMap((locale) => documents.map((document) => ({ locale, document }))),
  };
  validateManifestTopology(historicalManifest);
  const futureManifest = {
    ...validRoot,
    release: "2026-08-02.1",
    documents: releaseLocales.flatMap((locale) => documents.map((document) => ({ locale, document }))),
  };
  validateManifestTopology(futureManifest);
  assert.throws(() => validateManifestTopology({ ...futureManifest, documents: futureManifest.documents.slice(0, -1) }), /document count/);
  assert.throws(() => validateManifestTopology({ ...futureManifest, documents: futureManifest.documents.slice(0, -1).concat(futureManifest.documents[0]) }), /topology/);
  const isolated = await mkdtemp(resolve(tmpdir(), "adaivo-legal-self-test-"));
  const historicalFixture = await mkdtemp(resolve(tmpdir(), "adaivo-legal-historical-"));
  const rejected = await mkdtemp(resolve(tmpdir(), "adaivo-legal-rejected-"));
  const approvedFixture = await mkdtemp(resolve(tmpdir(), "adaivo-legal-approved-"));
  const staleMetadataFixture = await mkdtemp(resolve(tmpdir(), "adaivo-legal-stale-metadata-"));
  const futureDraftFixture = await mkdtemp(resolve(tmpdir(), "adaivo-legal-future-draft-"));
  const synonymWarningFixture = await mkdtemp(resolve(tmpdir(), "adaivo-legal-synonym-warning-"));
  const parameterTarget = await mkdtemp(resolve(tmpdir(), "adaivo-legal-parameter-"));
  const sourceRelease = "2026-08-08.1";
  const sourceEffectiveDate = "2026-08-08";
  const futureRelease = "2026-08-09.1";
  const futureEffectiveDate = "2026-08-09";
  try {
    function releaseReadyErrorLine(result) {
      return result.stderr.split("\n").find((line) => line.startsWith("Error: release_ready_rejected:"));
    }
    await cp(resolve(root, "content"), resolve(historicalFixture, "content"), { recursive: true });
    for (const locale of historicalLocales) for (const document of documents) {
      const source = resolve(historicalFixture, "content", locale, `${document}.md`);
      const text = await readFile(source, "utf8");
      await writeFile(source, text.replaceAll("2026-08-08.1", historicalRelease).replaceAll("2026-08-08", "2026-07-23"));
    }
    const historicalBuild = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", historicalRelease, "--effective-date", "2026-07-23", "--content-root", historicalFixture, "--output-dir", isolated], { cwd: root, encoding: "utf8" });
    assert.equal(historicalBuild.status, 0, historicalBuild.stderr);
    const defaultHistoricalNotices = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--content-root", historicalFixture, "--output-dir", isolated], { cwd: root, encoding: "utf8" });
    assert.equal(defaultHistoricalNotices.status, 0, defaultHistoricalNotices.stderr);
    for (const command of [
      ["scripts/build-manifest.mjs", "--release", historicalRelease, "--output-dir", parameterTarget],
      ["scripts/build-runtime-notices.mjs", "--release", historicalRelease, "--output-dir", parameterTarget],
      ["scripts/verify-legal-release.mjs", "--release", historicalRelease],
    ]) {
      const result = spawnSync(process.execPath, command, { cwd: root, encoding: "utf8" });
      assert.notEqual(result.status, 0, `partial metadata arguments must fail: ${command[0]}`);
      assert.match(result.stderr, /supplied together/);
    }
    for (const command of [
      ["scripts/build-manifest.mjs", "--release", historicalRelease, "--effective-date", "2099-12-31", "--output-dir", parameterTarget],
      ["scripts/build-runtime-notices.mjs", "--release", historicalRelease, "--effective-date", "2099-12-31", "--output-dir", parameterTarget],
      ["scripts/verify-legal-release.mjs", "--release", historicalRelease, "--effective-date", "2099-12-31"],
    ]) {
      const result = spawnSync(process.execPath, command, { cwd: root, encoding: "utf8" });
      assert.notEqual(result.status, 0, `historical metadata mismatch must fail: ${command[0]}`);
      assert.match(result.stderr, /historical release effective-date/);
    }
    assert.deepEqual(await readdir(parameterTarget), [], "invalid metadata must not create output");
    const futureBuild = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
    assert.notEqual(futureBuild.status, 0, "draft content must reject a future manifest build");
    assert.equal(releaseReadyErrorLine(futureBuild), "Error: release_ready_rejected: en/terms: release mismatch");
    assert.deepEqual(await readdir(rejected), [], "future manifest rejection must not leave partial output");
    const futureNotices = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
    assert.notEqual(futureNotices.status, 0, "draft content must reject future runtime notices");
    assert.equal(releaseReadyErrorLine(futureNotices), "Error: release_ready_rejected: en/terms: release mismatch");
    assert.deepEqual(await readdir(rejected), [], "future notices rejection must not leave partial output");

    async function prepareApprovedFixture(fixture, updatePrimaryMetadata) {
      await cp(resolve(root, "content"), resolve(fixture, "content"), { recursive: true });
      await mkdir(resolve(fixture, "inventory"), { recursive: true });
      await cp(resolve(root, "inventory/runtime-lock-inventory.json"), resolve(fixture, "inventory/runtime-lock-inventory.json"));
      for (const locale of releaseLocales) for (const document of documents) {
        const source = resolve(fixture, "content", locale, `${document}.md`);
        const text = await readFile(source, "utf8");
        let approved = text;
        if (["ja", "ko", "zh-Hant-HK"].includes(locale)) {
          const firstSection = text.indexOf("\n## ");
          const title = text.match(/^# .+$/m)?.[0];
          assert.notEqual(firstSection, -1);
          assert(title);
          approved = `${title}\n\n**Document status:** APPROVED — NATIVE-LANGUAGE AND LEGAL REVIEW COMPLETE — APPROVED FOR RELEASE AND PUBLICATION\n\n**Release:** ${sourceRelease}\n**Effective date:** ${sourceEffectiveDate}${text.slice(firstSection)}`;
        }
        await writeFile(source, updatePrimaryMetadata
          ? approved.replaceAll(sourceRelease, futureRelease).replaceAll(sourceEffectiveDate, futureEffectiveDate)
          : approved);
      }
    }

    await prepareApprovedFixture(approvedFixture, true);
    await prepareApprovedFixture(staleMetadataFixture, false);
    await cp(resolve(root, "content"), resolve(futureDraftFixture, "content"), { recursive: true });
    await mkdir(resolve(futureDraftFixture, "inventory"), { recursive: true });
    await cp(resolve(root, "inventory/runtime-lock-inventory.json"), resolve(futureDraftFixture, "inventory/runtime-lock-inventory.json"));
    for (const locale of releaseLocales) for (const document of documents) {
      const source = resolve(futureDraftFixture, "content", locale, `${document}.md`);
      const text = await readFile(source, "utf8");
      const released = text.replaceAll(sourceRelease, futureRelease).replaceAll(sourceEffectiveDate, futureEffectiveDate);
      if (!["ja", "ko", "zh-Hant-HK"].includes(locale)) {
        await writeFile(source, released);
        continue;
      }
      const firstSection = released.indexOf("\n## ");
      const title = released.match(/^# .+$/m)?.[0];
      assert.notEqual(firstSection, -1);
      assert(title);
      await writeFile(source, `${title}\n\n**Document status:** ${draftStatus}\n\n**Release:** ${futureRelease}\n**Effective date:** ${futureEffectiveDate}${released.slice(firstSection)}`);
    }
    const futureDraftManifest = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", futureDraftFixture, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
    assert.notEqual(futureDraftManifest.status, 0, "future draft fixture must reject the manifest build");
    assert.equal(releaseReadyErrorLine(futureDraftManifest), "Error: release_ready_rejected: ja/terms draft status remains");
    assert.deepEqual(await readdir(rejected), [], "draft manifest rejection must not leave partial output");
    const futureDraftNotices = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", futureDraftFixture, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
    assert.notEqual(futureDraftNotices.status, 0, "future draft fixture must reject runtime notices");
    assert.equal(releaseReadyErrorLine(futureDraftNotices), "Error: release_ready_rejected: ja/terms draft status remains");
    assert.deepEqual(await readdir(rejected), [], "draft notices rejection must not leave partial output");
    const staleApproval = spawnSync(process.execPath, ["scripts/verify-draft-content.mjs", "--root", staleMetadataFixture, "--mode", "release-ready", "--release", futureRelease, "--effective-date", futureEffectiveDate], { cwd: root, encoding: "utf8" });
    assert.notEqual(staleApproval.status, 0, "future approval policy must reject historical primary metadata");
    assert.match(staleApproval.stderr, /release mismatch|effective date mismatch/);
    const approval = spawnSync(process.execPath, ["scripts/verify-draft-content.mjs", "--root", approvedFixture, "--mode", "release-ready", "--release", futureRelease, "--effective-date", futureEffectiveDate], { cwd: root, encoding: "utf8" });
    assert.equal(approval.status, 0, approval.stderr);
    await mkdir(resolve(synonymWarningFixture, "inventory"), { recursive: true });
    await cp(resolve(root, "inventory/runtime-lock-inventory.json"), resolve(synonymWarningFixture, "inventory/runtime-lock-inventory.json"));
    const synonymWarnings = {
      ja: "この文書は公開前の確認を必要とします。",
      ko: "이 문서는 공개 전에 별도 확인이 필요합니다.",
      "zh-Hant-HK": "本文件在公開前仍需另行確認。",
    };
    for (const [locale, warning] of Object.entries(synonymWarnings)) {
      await rm(resolve(synonymWarningFixture, "content"), { recursive: true, force: true });
      await cp(resolve(approvedFixture, "content"), resolve(synonymWarningFixture, "content"), { recursive: true });
      const source = resolve(synonymWarningFixture, "content", locale, "terms.md");
      const text = await readFile(source, "utf8");
      await writeFile(source, text.replace(`**Effective date:** ${futureEffectiveDate}\n`, `**Effective date:** ${futureEffectiveDate}\n\n${warning}\n`));
      const synonymPolicy = spawnSync(process.execPath, ["scripts/verify-draft-content.mjs", "--root", synonymWarningFixture, "--mode", "release-ready", "--release", futureRelease, "--effective-date", futureEffectiveDate], { cwd: root, encoding: "utf8" });
      assert.notEqual(synonymPolicy.status, 0, `${locale}: synonym draft-warning prose must fail release-ready validation`);
      assert.match(synonymPolicy.stderr, new RegExp(`${locale}/terms approved preamble`));
      const synonymManifest = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", synonymWarningFixture, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
      assert.notEqual(synonymManifest.status, 0, `${locale}: synonym draft-warning prose must fail the manifest build`);
      assert.match(releaseReadyErrorLine(synonymManifest) ?? "", new RegExp(`${locale}/terms approved preamble`));
      assert.deepEqual(await readdir(rejected), [], `${locale}: synonym manifest rejection must not leave partial output`);
      const synonymNotices = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", synonymWarningFixture, "--output-dir", rejected], { cwd: root, encoding: "utf8" });
      assert.notEqual(synonymNotices.status, 0, `${locale}: synonym draft-warning prose must fail runtime notices`);
      assert.match(releaseReadyErrorLine(synonymNotices) ?? "", new RegExp(`${locale}/terms approved preamble`));
      assert.deepEqual(await readdir(rejected), [], `${locale}: synonym notices rejection must not leave partial output`);
    }
    const futureOutput = await mkdtemp(resolve(tmpdir(), "adaivo-legal-future-output-"));
    try {
      const approvedNotices = spawnSync(process.execPath, ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture, "--output-dir", futureOutput], { cwd: root, encoding: "utf8" });
      assert.equal(approvedNotices.status, 0, approvedNotices.stderr);
      const approvedBuild = spawnSync(process.execPath, ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture, "--output-dir", futureOutput], { cwd: root, encoding: "utf8" });
      assert.equal(approvedBuild.status, 0, approvedBuild.stderr);
      const generatedManifest = JSON.parse(await readFile(resolve(futureOutput, "manifest.json"), "utf8"));
      validateManifestTopology(generatedManifest);
      for (const [locale, chrome] of Object.entries(pageChrome)) {
        const page = await readFile(resolve(futureOutput, "site", locale, "terms", "index.html"), "utf8");
        assert(page.includes(`aria-label="${chrome.navigation}"`), `${locale}: localized navigation label missing`);
        assert(page.includes(chrome.canonicalMarkdown), `${locale}: localized canonical label missing`);
        assert(page.includes(chrome.rights), `${locale}: localized footer missing`);
      }
      const futureLicenses = await readFile(resolve(futureOutput, "content/en/licenses.md"), "utf8");
      assert(futureLicenses.includes(`**Release:** ${futureRelease}`));
      assert(futureLicenses.includes(`**Effective date:** ${futureEffectiveDate}`));

      async function snapshot(directory, relative = "") {
        const output = [];
        for (const entry of await readdir(resolve(directory, relative), { withFileTypes: true })) {
          const next = relative ? `${relative}/${entry.name}` : entry.name;
          const path = resolve(directory, next);
          const status = await lstat(path);
          if (status.isDirectory()) output.push(`d:${next}`, ...await snapshot(directory, next));
          else if (status.isFile()) output.push(`f:${next}:${createHash("sha256").update(await readFile(path)).digest("hex")}`);
          else if (status.isSymbolicLink()) output.push(`l:${next}:${await readlink(path)}`);
          else output.push(`other:${next}`);
        }
        return output.sort();
      }
      async function assertLateFailureRollsBack(kind, command, collisionPath) {
        const target = await mkdtemp(resolve(tmpdir(), `adaivo-legal-${kind}-rollback-`));
        try {
          await mkdir(resolve(target, collisionPath, ".."), { recursive: true });
          await writeFile(resolve(target, collisionPath), "preexisting collision");
          await writeFile(resolve(target, "keep.txt"), "keep");
          const before = await snapshot(target);
          const result = spawnSync(process.execPath, command.concat(["--output-dir", target]), { cwd: root, encoding: "utf8" });
          assert.notEqual(result.status, 0, `${kind}: late write must fail`);
          assert.deepEqual(await snapshot(target), before, `${kind}: target changed after late write failure`);
          const parentEntries = await readdir(resolve(target, ".."));
          assert(!parentEntries.some((entry) => entry.startsWith(`.${target.split("/").at(-1)}.staging-`) || entry.startsWith(`.${target.split("/").at(-1)}.backup-`)), `${kind}: transaction artifacts remain`);
        } finally {
          await rm(target, { recursive: true, force: true });
        }
      }
      async function assertNonRegularDestinationRejected(kind, command, collisionPath, type) {
        const target = await mkdtemp(resolve(tmpdir(), `adaivo-legal-${kind}-${type}-destination-`));
        try {
          await mkdir(resolve(target, collisionPath, ".."), { recursive: true });
          if (type === "directory") {
            await mkdir(resolve(target, collisionPath));
            await writeFile(resolve(target, collisionPath, "sentinel.txt"), "sentinel");
          } else {
            await writeFile(resolve(target, "sentinel.txt"), "sentinel");
            await symlink(resolve(target, "sentinel.txt"), resolve(target, collisionPath));
          }
          const before = await snapshot(target);
          const result = spawnSync(process.execPath, command.concat(["--output-dir", target]), { cwd: root, encoding: "utf8" });
          assert.notEqual(result.status, 0, `${kind}: ${type} destination must reject`);
          assert.match(result.stderr, /destination must be a regular file/);
          assert.deepEqual(await snapshot(target), before, `${kind}: ${type} destination changed after rejection`);
          const parentEntries = await readdir(resolve(target, ".."));
          assert(!parentEntries.some((entry) => entry.startsWith(`.${target.split("/").at(-1)}.staging-`) || entry.startsWith(`.${target.split("/").at(-1)}.backup-`)), `${kind}: ${type} transaction artifacts remain`);
        } finally {
          await rm(target, { recursive: true, force: true });
        }
      }
      await assertLateFailureRollsBack("manifest", ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture], "site/assets");
      await assertLateFailureRollsBack("notices", ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture], "content/zh-Hans");
      for (const type of ["directory", "symlink"]) {
        await assertNonRegularDestinationRejected("manifest", ["scripts/build-manifest.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture], "manifest.json", type);
        await assertNonRegularDestinationRejected("notices", ["scripts/build-runtime-notices.mjs", "--release", futureRelease, "--effective-date", futureEffectiveDate, "--content-root", approvedFixture], "content/en/licenses.md", type);
      }
    } finally {
      await rm(futureOutput, { recursive: true, force: true });
    }
  } finally {
    await rm(isolated, { recursive: true, force: true });
    await rm(historicalFixture, { recursive: true, force: true });
    await rm(rejected, { recursive: true, force: true });
    await rm(approvedFixture, { recursive: true, force: true });
    await rm(staleMetadataFixture, { recursive: true, force: true });
    await rm(futureDraftFixture, { recursive: true, force: true });
    await rm(synonymWarningFixture, { recursive: true, force: true });
    await rm(parameterTarget, { recursive: true, force: true });
  }
  console.log("legal release self-test passed");
} else {
  await verify();
  console.log("legal release verification passed");
}
