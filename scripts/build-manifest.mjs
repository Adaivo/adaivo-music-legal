import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { writeTransactionally } from "./output-transaction.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const publicBaseUrl = "https://adaivo.github.io/adaivo-music-legal/";
const historicalRelease = "2026-07-23.1";
const historicalLocales = ["en", "zh-Hans"];
const releaseLocales = ["en", "zh-Hans", "ja", "ko", "zh-Hant-HK"];
const documents = ["licenses", "privacy", "terms"];
const allowedHosts = new Set(["registry.npmjs.org", "spdx.org", "www.apache.org", "opensource.org", "www.openssl.org"]);

function optionalArg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : resolve(process.argv[i + 1]);
}
const releaseIndex = process.argv.indexOf("--release");
const effectiveDateIndex = process.argv.indexOf("--effective-date");
if (releaseIndex < 0 && effectiveDateIndex < 0) throw new Error("missing --release and --effective-date");
if ((releaseIndex < 0) !== (effectiveDateIndex < 0)) throw new Error("--release and --effective-date must be supplied together");
const release = process.argv[releaseIndex + 1];
const effectiveDate = process.argv[effectiveDateIndex + 1];
if (!release || !effectiveDate) throw new Error("--release and --effective-date must be supplied together");
const outputRoot = optionalArg("--output-dir", root);
const contentRoot = optionalArg("--content-root", root);
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("invalid release metadata");
if (release === historicalRelease && effectiveDate !== "2026-07-23") throw new Error("historical release effective-date must equal 2026-07-23");
const locales = release === historicalRelease ? historicalLocales : releaseLocales;
const requiresFiveLocaleRelease = release !== historicalRelease;

function normalize(value) {
  const text = value.replace(/\r\n?/g, "\n").normalize("NFC");
  if (Buffer.byteLength(text) > 256_000) throw new Error("document exceeds size limit");
  if (/<\/?[A-Za-z][^>]*>|!\[[^\]]*\]\(/.test(text)) throw new Error("raw HTML and images are forbidden");
  for (const match of text.matchAll(/https?:\/\/[^\s)`]+/g)) {
    const url = new URL(match[0]);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error(`URL not allowed: ${url}`);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

function assertFutureReleaseReady() {
  if (!requiresFiveLocaleRelease) return;
  const result = spawnSync(process.execPath, [
    "scripts/verify-draft-content.mjs",
    "--root", contentRoot,
    "--mode", "release-ready",
    "--release", release,
    "--effective-date", effectiveDate,
  ], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const nestedReason = /release_ready_rejected: ([^\r\n]+)/.exec(result.stderr)?.[1];
    const assertionReason = /AssertionError(?: \[[^\]]+\])?:\s*([^\r\n]+)/.exec(result.stderr)?.[1];
    throw new Error(`release_ready_rejected: ${nestedReason ?? assertionReason ?? `policy process exited ${result.status}`}`);
  }
}

function inline(text) {
  const escapeText = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const formatText = (value) => escapeText(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const pattern = /https:\/\/[^\s<>"';；,，。]+/g;
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    output += formatText(text.slice(cursor, match.index));
    const raw = match[0];
    const suffix = /[.,;:，。；：]$/.test(raw) ? raw.slice(-1) : "";
    const href = suffix ? raw.slice(0, -1) : raw;
    const parsed = new URL(href);
    if (!allowedHosts.has(parsed.hostname)) throw new Error(`URL not allowed: ${parsed}`);
    const attribute = parsed.href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    output += `<a href="${attribute}" rel="noopener noreferrer">${escapeText(href)}</a>${escapeText(suffix)}`;
    cursor = match.index + raw.length;
  }
  return output + formatText(text.slice(cursor));
}

function renderMarkdown(markdown) {
  const out = [];
  let listOpen = false;
  for (const line of markdown.trim().split("\n")) {
    if (/^- /.test(line)) {
      if (!listOpen) out.push("<ul>");
      listOpen = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (listOpen) { out.push("</ul>"); listOpen = false; }
    if (!line) continue;
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else out.push(`<p>${inline(line.replace(/  $/, ""))}</p>`);
  }
  if (listOpen) out.push("</ul>");
  return out.join("\n");
}

const css = `:root{color-scheme:light dark;--bg:#f6f3ed;--panel:#fffdf8;--ink:#18231f;--muted:#56645f;--accent:#176b57;--focus:#ca6f1e}
*{box-sizing:border-box}html{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65;background:var(--bg);color:var(--ink)}
body{margin:0}header,main,footer{width:min(760px,calc(100% - 2rem));margin-inline:auto}header{padding:1.25rem 0;display:flex;gap:1rem;justify-content:space-between;align-items:center;border-bottom:1px solid color-mix(in srgb,var(--ink) 18%,transparent)}
.brand{font-weight:800;color:var(--ink);text-decoration:none}nav{text-transform:capitalize}main{background:var(--panel);margin-block:2rem;padding:clamp(1.2rem,4vw,3rem);border-radius:1.2rem;box-shadow:0 12px 35px #0000000d}
h1{font-size:clamp(2rem,7vw,3.4rem);line-height:1.06}h2{margin-top:2.2rem;line-height:1.2}a{color:var(--accent);text-underline-offset:.2em}a:focus-visible{outline:3px solid var(--focus);outline-offset:4px;border-radius:.15rem}
footer{padding:0 0 2.5rem;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;padding:0;list-style:none}.cards a{display:block;padding:1rem;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);border-radius:.75rem}
code{overflow-wrap:anywhere}main a{overflow-wrap:anywhere;word-break:break-word}main li{overflow-wrap:anywhere;word-break:break-word}@media(max-width:430px){header{align-items:flex-start;flex-direction:column}main{margin-block:1rem;padding:1.1rem}.cards{grid-template-columns:1fr}nav{font-size:.92rem}}
@media(prefers-color-scheme:dark){:root{--bg:#101714;--panel:#17221e;--ink:#edf8f2;--muted:#adc2b8;--accent:#74d9bd;--focus:#ffb45e}main{box-shadow:none}}
`;
const cssFingerprint = createHash("sha256").update(css).digest("hex").slice(0, 16);
const pageChrome = {
  en: { navigation: "Legal documents", canonicalMarkdown: "Canonical Markdown", rights: "All rights reserved.", documents: { licenses: "Third-Party Notices", privacy: "Privacy Policy", terms: "Terms of Service" } },
  "zh-Hans": { navigation: "法律文件", canonicalMarkdown: "规范 Markdown", rights: "保留所有权利。", documents: { licenses: "第三方声明", privacy: "隐私政策", terms: "服务条款" } },
  ja: { navigation: "法的文書", canonicalMarkdown: "正規 Markdown", rights: "無断転載を禁じます。", documents: { licenses: "第三者ライセンス", privacy: "プライバシーポリシー", terms: "利用規約" } },
  ko: { navigation: "법률 문서", canonicalMarkdown: "정식 Markdown", rights: "모든 권리 보유.", documents: { licenses: "제3자 고지", privacy: "개인정보 처리방침", terms: "서비스 이용약관" } },
  "zh-Hant-HK": { navigation: "法律文件", canonicalMarkdown: "正式 Markdown", rights: "保留一切權利。", documents: { licenses: "第三方通知", privacy: "私隱政策", terms: "服務條款" } },
};
const historicalChrome = {
  navigation: "Legal documents",
  canonicalMarkdown: "Canonical Markdown",
  rights: "All rights reserved.",
  documents: { licenses: "licenses", privacy: "privacy", terms: "terms" },
};

assertFutureReleaseReady();
const sourceDocuments = [];
for (const locale of locales) {
  for (const document of documents) {
    const source = `content/${locale}/${document}.md`;
    const markdown = normalize(await readFile(resolve(contentRoot, source), "utf8"));
    sourceDocuments.push({ locale, document, source, markdown });
  }
}
const preparedDocuments = [];
for (const { locale, document, source, markdown } of sourceDocuments) {
    if (!markdown.includes(release) || !markdown.includes(effectiveDate)) throw new Error(`metadata missing in ${source}`);
    preparedDocuments.push({ locale, document, source, markdown, bytes: Buffer.from(markdown) });
}

await writeTransactionally(outputRoot, async (stagedOutputRoot) => {
const entries = [];
for (const { locale, document, source, markdown, bytes } of preparedDocuments) {
    const chrome = requiresFiveLocaleRelease ? pageChrome[locale] : historicalChrome;
    const releasePath = `site/releases/${release}/${locale}/${document}.md`;
    await mkdir(dirname(resolve(stagedOutputRoot, releasePath)), { recursive: true });
    await writeFile(resolve(stagedOutputRoot, releasePath), bytes);
    const pagePath = `site/${locale}/${document}/index.html`;
    await mkdir(dirname(resolve(stagedOutputRoot, pagePath)), { recursive: true });
    const title = markdown.match(/^# (.+)$/m)?.[1] ?? document;
    const nav = documents.map((item) => `<a href="../${item}/">${chrome.documents[item]}</a>`).join(" · ");
    const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${inline(title)}</title><link rel="stylesheet" href="../../assets/legal.css?v=${cssFingerprint}"></head>
<body><header><a class="brand" href="../../">Adaivo Music</a><nav aria-label="${chrome.navigation}">${nav}</nav></header><main>${renderMarkdown(markdown)}</main><footer>© 2026 Adaivo. ${chrome.rights} <a href="../../releases/${release}/${locale}/${document}.md">${chrome.canonicalMarkdown}</a></footer></body></html>
`;
    await writeFile(resolve(stagedOutputRoot, pagePath), html);
    entries.push({ locale, document, source, page: `${locale}/${document}/`, markdown: `${publicBaseUrl}releases/${release}/${locale}/${document}.md`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
entries.sort((a, b) => `${a.locale}/${a.document}`.localeCompare(`${b.locale}/${b.document}`));
const manifest = { schemaVersion: 1, release, effectiveDate, generatedFrom: "c810e47c83771fafea1366a6a58d4762c553b751", documents: entries };
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(resolve(stagedOutputRoot, "manifest.json"), manifestText);
await mkdir(resolve(stagedOutputRoot, "site/assets"), { recursive: true });
await writeFile(resolve(stagedOutputRoot, "site/manifest.json"), manifestText);

const cards = entries.map((entry) => `<li><a href="${entry.page}">${entry.locale} · ${entry.document}</a></li>`).join("");
await writeFile(resolve(stagedOutputRoot, "site/index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Adaivo Music Legal</title><link rel="stylesheet" href="assets/legal.css?v=${cssFingerprint}"></head>
<body><header><span class="brand">Adaivo Music</span></header><main><h1>Legal documents · 法律文件</h1><p>Release ${release} · Effective ${effectiveDate}</p><ul class="cards">${cards}</ul><p><a href="manifest.json">Release manifest</a></p></main><footer>© 2026 Adaivo. All rights reserved. Public readability does not grant reuse.</footer></body></html>
`);
await writeFile(resolve(stagedOutputRoot, "site/assets/legal.css"), css);
});
