import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { writeTransactionally } from "./output-transaction.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const outputIndex = process.argv.indexOf("--output-dir");
const outputRoot = outputIndex < 0 ? root : resolve(process.argv[outputIndex + 1]);
const historicalRelease = "2026-07-23.1";
const historicalEffectiveDate = "2026-07-23";
const historicalLocales = ["en", "zh-Hans"];
const releaseLocales = ["en", "zh-Hans", "ja", "ko", "zh-Hant-HK"];
const releaseIndex = process.argv.indexOf("--release");
const effectiveDateIndex = process.argv.indexOf("--effective-date");
if ((releaseIndex < 0) !== (effectiveDateIndex < 0)) throw new Error("--release and --effective-date must be supplied together");
const release = releaseIndex < 0 ? historicalRelease : process.argv[releaseIndex + 1];
const effectiveDate = effectiveDateIndex < 0 ? historicalEffectiveDate : process.argv[effectiveDateIndex + 1];
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate ?? "")) throw new Error("invalid release metadata");
if (release === historicalRelease && effectiveDate !== historicalEffectiveDate) throw new Error("historical release effective-date must equal 2026-07-23");
const locales = release === historicalRelease ? historicalLocales : releaseLocales;
const requiresFiveLocaleRelease = release !== historicalRelease;
const documents = ["licenses", "privacy", "terms"];
const contentRootIndex = process.argv.indexOf("--content-root");
const contentRoot = contentRootIndex < 0 ? root : resolve(process.argv[contentRootIndex + 1]);
const inventory = JSON.parse(await readFile(resolve(root, "inventory/runtime-lock-inventory.json"), "utf8"));
assert.equal(inventory.count, 660);
assert.equal(inventory.entries.length, 660);

if (requiresFiveLocaleRelease) {
  const policy = spawnSync(process.execPath, [
    "scripts/verify-draft-content.mjs",
    "--root", contentRoot,
    "--mode", "release-ready",
    "--release", release,
    "--effective-date", effectiveDate,
  ], { cwd: root, encoding: "utf8" });
  if (policy.status !== 0) {
    const nestedReason = /release_ready_rejected: ([^\r\n]+)/.exec(policy.stderr)?.[1];
    const assertionReason = /AssertionError(?: \[[^\]]+\])?:\s*([^\r\n]+)/.exec(policy.stderr)?.[1];
    throw new Error(`release_ready_rejected: ${nestedReason ?? assertionReason ?? `policy process exited ${policy.status}`}`);
  }
}

const sourceDocuments = new Map();
for (const locale of locales) for (const document of documents) {
  const source = `content/${locale}/${document}.md`;
  sourceDocuments.set(`${locale}/${document}`, await readFile(resolve(contentRoot, source), "utf8"));
}

const licenseLinks = {
  "0BSD": "https://spdx.org/licenses/0BSD.html",
  "Apache-2.0": "https://spdx.org/licenses/Apache-2.0.html",
  "BlueOak-1.0.0": "https://spdx.org/licenses/BlueOak-1.0.0.html",
  "BSD-2-Clause": "https://spdx.org/licenses/BSD-2-Clause.html",
  "BSD-3-Clause": "https://spdx.org/licenses/BSD-3-Clause.html",
  "CC-BY-4.0": "https://spdx.org/licenses/CC-BY-4.0.html",
  "CC0-1.0": "https://spdx.org/licenses/CC0-1.0.html",
  ISC: "https://spdx.org/licenses/ISC.html",
  MIT: "https://spdx.org/licenses/MIT.html",
  "Python-2.0": "https://spdx.org/licenses/Python-2.0.html",
  Unlicense: "https://spdx.org/licenses/Unlicense.html"
};

function options(expression) {
  return [...expression.matchAll(/[A-Za-z0-9.-]+/g)].map((match) => match[0]).filter((value) => licenseLinks[value]);
}

for (const entry of inventory.entries) {
  assert(entry.name && entry.version && entry.resolved && entry.license);
  assert.equal(entry.repository, null);
  assert.equal(entry.copyright, null);
  assert(options(entry.license).length > 0, `no compliant license link for ${entry.path}: ${entry.license}`);
}

const enRows = inventory.entries.map((entry) =>
  `- package: ${entry.name}; version: ${entry.version}; lock path: ${entry.path}; source: ${entry.resolved}; repository: Not recorded; copyright: Not recorded; license: ${entry.license}${entry.patched ? "; patched locally, upstream license retained" : ""}.`
).join("\n");
const zhRows = inventory.entries.map((entry) =>
  `- 软件包：${entry.name}；版本：${entry.version}；锁路径：${entry.path}；源链接：${entry.resolved}；仓库：未记录；版权：未记录；许可：${entry.license}${entry.patched ? "；应用本地补丁并保留上游许可" : ""}。`
).join("\n");
const usedLicenses = [...new Set(inventory.entries.flatMap((entry) => options(entry.license)))].sort();
const enLinks = usedLicenses.map((license) => `- ${license}: ${licenseLinks[license]}`).join("\n");
const zhLinks = usedLicenses.map((license) => `- ${license}：${licenseLinks[license]}`).join("\n");

const en = `# Adaivo Music Third-Party Notices

**Release:** ${release}
**Effective date:** ${effectiveDate}

## Scope

These are the notices included for the current release built from Adaivo Music commit ${inventory.sourceCommit}. The JavaScript inventory is the complete ${inventory.count}-entry runtime closure deterministically derived from the exact package-lock v3 root runtime dependencies, dependencies, optional dependencies, and peer dependencies using package-lock node_modules resolution.

The lock metadata records no repository or copyright fields for these entries. “Not recorded” is explicit and no value is inferred. Resolved source archives are separate from repository metadata. No entry has a missing or unidentified license, and none delegates its license to another named file. The three multi-license expressions are preserved exactly. Local patches apply to react-native-blob-util and react-native-track-player; their upstream licenses remain identified.

This JavaScript closure is not a binary-derived native inventory. Final iOS and Android store binaries require regenerated and reviewed native dependency/license reports before store launch. This document does not claim native completeness.

Adaivo-authored music, legal text, code, and brand material are not open source and are not licensed by this notice.

## Runtime JavaScript inventory

${enRows}

## License texts and notices

The exact expression on each inventory row controls. For multi-license expressions, each available option is linked below. Copyright and attribution remain with the respective upstream authors and contributors.

${enLinks}

## Native release gate

Identifiable committed inputs include React Native and Hermes families, AppAuth and Google support libraries, Nitro/OpenIAP components, Yoga, and OpenSSL-Universal. Android test-only dependencies are excluded by committed Gradle configuration. This summary is not a substitute for notices generated from final signed binaries; native binary-derived reports remain mandatory before store release.
`;

const zh = `# Adaivo Music 第三方声明

**发布版本：** ${release}
**生效日期：** ${effectiveDate}

如中英文版本发生冲突，以英文版本为准，但适用法律禁止如此约定的除外。

## 范围

这是基于 Adaivo Music 提交 ${inventory.sourceCommit} 构建的当前版本所含声明。JavaScript 清单是从精确的 package-lock v3 根运行时依赖、dependencies、optionalDependencies 和 peerDependencies 按 package-lock node_modules 解析规则确定性推导出的完整 ${inventory.count} 项运行时闭包。

锁文件元数据没有记录这些条目的仓库或版权字段。“未记录”为明确状态，本文不作推断。解析后源归档与仓库元数据分开列示。没有条目缺失许可、使用未识别许可，或将许可指向另一个命名文件。三个多许可表达式按原样保留。react-native-blob-util 和 react-native-track-player 应用本地补丁，其上游许可标识保持不变。

此 JavaScript 闭包不是从原生二进制文件生成的清单。应用商店上线前，必须从最终 iOS 和 Android 商店二进制文件重新生成并审阅原生依赖与许可报告。本文不声称原生清单完整。

Adaivo 创作的音乐、法律文本、代码及品牌材料不是开源内容，也不通过本声明授予许可。

## 运行时 JavaScript 清单

${zhRows}

## 许可文本与声明

每个清单条目中的精确许可表达式具有约束力。多许可表达式的各个可选许可均在下方链接。版权及署名仍归各上游作者和贡献者所有。

${zhLinks}

## 原生发布门

可识别的已提交输入包括 React Native 与 Hermes 系列、AppAuth 与 Google 支持库、Nitro/OpenIAP 组件、Yoga 及 OpenSSL-Universal。已提交的 Gradle 配置排除 Android 仅测试依赖。本摘要不能替代从最终签名二进制文件生成的声明；商店发布前仍必须取得原生二进制派生报告。
`;

const inventoryPrefix = "- package: ";
const englishInventoryRows = sourceDocuments.get("en/licenses")
  .split("\n")
  .filter((line) => line.startsWith(inventoryPrefix));
if (englishInventoryRows.length !== inventory.count) {
  throw new Error("content/en/licenses.md: runtime inventory row count mismatch");
}

const generatedNotices = new Map([
  ["en", en],
  ["zh-Hans", zh],
]);
for (const locale of locales.filter((locale) => !["en", "zh-Hans"].includes(locale))) {
  const markdown = sourceDocuments.get(`${locale}/licenses`);
  const localizedInventoryRows = markdown
    .split("\n")
    .filter((line) => line.startsWith(inventoryPrefix));
  if (JSON.stringify(localizedInventoryRows) !== JSON.stringify(englishInventoryRows)) {
    throw new Error(`${locale}/licenses: runtime inventory metadata drifted`);
  }
  generatedNotices.set(locale, markdown);
}

await writeTransactionally(outputRoot, async (stagedOutputRoot) => {
  for (const [locale, markdown] of generatedNotices) {
    await mkdir(resolve(stagedOutputRoot, "content", locale), { recursive: true });
    await writeFile(resolve(stagedOutputRoot, "content", locale, "licenses.md"), markdown);
  }
});
