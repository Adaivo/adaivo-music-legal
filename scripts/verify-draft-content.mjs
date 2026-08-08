import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex < 0
  ? resolve(new URL('..', import.meta.url).pathname)
  : resolve(process.argv[rootIndex + 1]);
const selfTest = process.argv.includes('--self-test');
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? (selfTest ? 'release-ready' : null) : process.argv[modeIndex + 1];
if (!['draft-inventory', 'release-ready'].includes(mode)) {
  throw new Error('usage: node scripts/verify-draft-content.mjs --mode <draft-inventory|release-ready>');
}

const locales = ['en', 'zh-Hans', 'ja', 'ko', 'zh-Hant-HK'];
const documents = ['terms', 'privacy', 'licenses'];
const documentTitles = {
  en: {terms: 'Adaivo Music Terms of Service', privacy: 'Adaivo Music Privacy Policy', licenses: 'Adaivo Music Third-Party Notices'},
  'zh-Hans': {terms: 'Adaivo Music 服务条款', privacy: 'Adaivo Music 隐私政策', licenses: 'Adaivo Music 第三方声明'},
  ja: {terms: 'Adaivo Music 利用規約', privacy: 'Adaivo Music プライバシーポリシー', licenses: 'Adaivo Music 第三者ライセンスに関する通知'},
  ko: {terms: 'Adaivo Music 서비스 이용약관', privacy: 'Adaivo Music 개인정보 처리방침', licenses: 'Adaivo Music 제3자 고지'},
  'zh-Hant-HK': {terms: 'Adaivo Music 服務條款', privacy: 'Adaivo Music 私隱政策', licenses: 'Adaivo Music 第三方通知'},
};
const draftLocales = new Set(['ja', 'ko', 'zh-Hant-HK']);
const historicalRelease = '2026-07-23.1';
const historicalEffectiveDate = '2026-07-23';
const releaseIndex = process.argv.indexOf('--release');
const effectiveDateIndex = process.argv.indexOf('--effective-date');
if ((releaseIndex < 0) !== (effectiveDateIndex < 0)) {
  throw new Error('--release and --effective-date must be supplied together');
}
const release = releaseIndex < 0
  ? (selfTest ? '2026-08-08.1' : historicalRelease)
  : process.argv[releaseIndex + 1];
const effectiveDate = effectiveDateIndex < 0
  ? (selfTest ? '2026-08-08' : historicalEffectiveDate)
  : process.argv[effectiveDateIndex + 1];
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
  throw new Error('invalid release metadata');
}
const draftStatus = 'DRAFT — NOT LEGALLY REVIEWED — NOT APPROVED FOR RELEASE OR PUBLICATION';
const approvedStatus = 'APPROVED — NATIVE-LANGUAGE AND LEGAL REVIEW COMPLETE — APPROVED FOR RELEASE AND PUBLICATION';
const draftWarnings = {
  ja: '本書は母語話者および法務による審査前の翻訳初稿です。公開、配布、または法的助言として使用してはなりません。',
  ko: '본 문서는 원어민 및 법률 검토 전의 번역 초안입니다. 공개, 배포 또는 법률 자문으로 사용해서는 안 됩니다.',
  'zh-Hant-HK': '本文件為待母語及法律審核的翻譯初稿，不得作公開、發佈或法律意見之用。',
};
const draftSemantics = {
  'ja/terms': [
    '重大な違反、詐欺、セキュリティリスク',
    '12 か月間にお客様が Adaivo に支払った金額と CAD $100 のいずれか大きい額',
    'お客様による違法な利用、お客様のコンテンツ、または本規約の重大な違反に起因する第三者からの請求、損失および合理的な費用について、Adaivo を補償し免責するものとします。',
  ],
  'ja/privacy': [
    '取引、返金、不正、紛争、税務その他の記録のうち、法令により保存が義務付けられるもの、または承認された目的のために合理的に必要なもののみを保持します。',
  ],
  'ko/terms': [
    '손실 없음을',
    '12개월 동안 이용자가 Adaivo에 지급한 금액과 CAD $100 중 더 큰 금액',
    '문의: info@adaivo.ai.',
  ],
  'ko/privacy': [
    'Adaivo에 민원을 제기할 수 있으며, 해당되는 경우 캐나다 개인정보보호위원회 또는 다른 관할 규제기관에도 민원을 제기할 수 있습니다.',
  ],
  'zh-Hant-HK/terms': [
    '特別、後果性或懲罰性損害，亦不就利潤損失承擔責任',
    '12 個月您向 Adaivo 支付的款項與 CAD $100 兩者中較高者',
    'Adaivo Music 由加拿大安大略省獨資經營者 Adaivo 營辦。聯絡方法：info@adaivo.ai。',
    '價格或試用安排可在按商店或法律要求發出通知後，只就日後作出更改。',
    '## 曲目庫及供應情況',
    '限制或終止使用權',
    '在不考慮法律衝突規則的情況下',
  ],
  'zh-Hant-HK/privacy': [
    '您可撤回同意，而撤回僅對將來生效。',
    '匿名使用：安裝識別碼或裝置識別碼，以及安全驗證憑證。',
    '本地資料：直至資料被清除、應用程式被解除安裝，或資料由操作系統移除。',
    '## 服務供應商及披露',
    '當地法律可能准許當局取用該等資料。',
    '資料最少化措施',
  ],
};

async function contentFiles(locale) {
  const directory = resolve(root, 'content', locale);
  const entries = await readdir(directory, {withFileTypes: true});
  for (const entry of entries) {
    assert(entry.isFile() && !entry.isSymbolicLink(),
      `${locale}: only regular document files are allowed (${entry.name})`);
    assert(['licenses.md', 'privacy.md', 'terms.md'].includes(entry.name),
      `${locale}: unexpected document file ${entry.name}`);
  }
  return entries.map(entry => entry.name).sort();
}

async function source(locale, document) {
  return readFile(resolve(root, 'content', locale, `${document}.md`), 'utf8');
}

function exactCount(text, value, label) {
  const count = text.split(value).length - 1;
  assert.equal(count, 1, `${label}: expected exactly one occurrence`);
}

function count(text, value) {
  return text.split(value).length - 1;
}

function sections(text) {
  return text.split(/(?=^## )/m).filter(section => section.startsWith('## '));
}

function validateTranslatedStructure(english, draft, locale, document) {
  const expected = document === 'terms' ? 15 : 11;
  const sourceSections = sections(english);
  const draftSections = sections(draft);
  assert.equal(sourceSections.length, expected, `en/${document}: expected ${expected} H2 sections`);
  assert.equal(draftSections.length, expected, `${locale}/${document}: H2 section count mismatch`);
  for (const [index, section] of draftSections.entries()) {
    assert(section.replace(/^##[^\n]*\n?/, '').trim().length > 0,
      `${locale}/${document}: H2 section ${index + 1} is empty`);
  }
}

function validateApprovedPreamble(text, locale, document) {
  const firstSection = text.indexOf('\n## ');
  assert.notEqual(firstSection, -1, `release_ready_rejected: ${locale}/${document} first section missing`);
  const nonEmptyLines = text.slice(0, firstSection)
    .split('\n')
    .filter((line) => line.trim().length > 0);
  assert.deepEqual(nonEmptyLines, [
    `# ${documentTitles[locale][document]}`,
    `**Document status:** ${approvedStatus}`,
    `**Release:** ${release}`,
    `**Effective date:** ${effectiveDate}`,
  ], `release_ready_rejected: ${locale}/${document} approved preamble must contain only title, approval, target release, and target effective date`);
}

for (const locale of locales) {
  assert.deepEqual(await contentFiles(locale), ['licenses.md', 'privacy.md', 'terms.md'],
    `${locale}: exact document set required`);
}
assert.deepEqual((await readdir(resolve(root, 'content'))).sort(), locales.slice().sort(),
  'content must contain exactly five locales');

const englishLicenses = await source('en', 'licenses');
const englishDocuments = {
  terms: await source('en', 'terms'),
  privacy: await source('en', 'privacy'),
};
const runtimeInventory = JSON.parse(await readFile(
  resolve(root, 'inventory', 'runtime-lock-inventory.json'),
  'utf8',
));
assert.equal(runtimeInventory.sourceCommit, 'c810e47c83771fafea1366a6a58d4762c553b751',
  'runtime inventory source commit mismatch');
assert.equal(runtimeInventory.count, 660, 'runtime inventory count mismatch');
assert.equal(runtimeInventory.entries.length, runtimeInventory.count,
  'runtime inventory entries mismatch');
const inventoryPrefix = '- package: ';
const englishInventoryRows = englishLicenses
  .split('\n')
  .filter(line => line.startsWith(inventoryPrefix));
assert.equal(englishInventoryRows.length, runtimeInventory.count,
  'English runtime inventory must have 660 entries');
for (const entry of runtimeInventory.entries) {
  const prefix = `- package: ${entry.name}; version: ${entry.version}; lock path: ${entry.path};`;
  const row = englishInventoryRows.find(line => line.startsWith(prefix));
  assert(row, `English runtime inventory missing ${entry.path}`);
  const expected = `${prefix} source: ${entry.resolved}; repository: Not recorded; copyright: Not recorded; license: ${entry.license}` +
    (entry.patched ? '; patched locally, upstream license retained.' : '.');
  assert.equal(row, expected, `English runtime inventory drifted for ${entry.path}`);
}

const localizedLicenseWrappers = {
  ja: {
    scope: [
      '## 範囲',
      '本通知は Adaivo Music コミット c810e47c83771fafea1366a6a58d4762c553b751 から構築された現在のリリースに含まれます。JavaScript インベントリは、厳密な package-lock v3 のルート実行時依存関係、依存関係、任意依存関係およびピア依存関係から、package-lock の node_modules 解決を用いて決定論的に導出した完全な 660 項目の実行時クロージャです。',
      'ロックのメタデータには、これらの項目のリポジトリまたは著作権欄は記録されていません。「Not recorded」は明示的であり、値を推測していません。解決済みソースアーカイブはリポジトリのメタデータとは別です。欠落または未識別のライセンスはなく、他の名前付きファイルにライセンスを委任する項目もありません。3 件の複数ライセンス式は正確に保持されています。ローカルパッチは react-native-blob-util および react-native-track-player に適用されますが、上流ライセンスは識別されたままです。',
      'この JavaScript クロージャはバイナリ由来のネイティブインベントリではありません。最終的な iOS および Android ストアバイナリには、ストア公開前に再生成・レビュー済みのネイティブ依存関係／ライセンスレポートが必要です。本書はネイティブ完全性を主張しません。',
      'Adaivo が作成した音楽、法的文書、コードおよびブランド資料はオープンソースではなく、本通知により許諾されません。',
    ],
    headings: [
      '## 実行時 JavaScript インベントリ',
      '## ライセンス本文および通知',
      '## ネイティブリリースのゲート',
    ],
    paragraphs: [
      '各インベントリ行の正確な表記が適用されます。複数ライセンス式については、利用可能な各選択肢を下にリンクしています。著作権および帰属表示は、それぞれの上流の著者および寄与者に帰属します。',
      '識別可能なコミット済み入力には、React Native と Hermes の各ファミリー、AppAuth と Google のサポートライブラリ、Nitro/OpenIAP コンポーネント、Yoga、および OpenSSL-Universal が含まれます。Android のテスト専用依存関係は、コミット済みの Gradle 設定により除外されています。この要約は最終署名済みバイナリから生成される通知に代わるものではありません。ストア公開前には、ネイティブバイナリ由来のレポートが引き続き必須です。',
    ],
  },
  ko: {
    scope: [
      '## 범위',
      '이 고지는 Adaivo Music 커밋 c810e47c83771fafea1366a6a58d4762c553b751에서 빌드된 현재 릴리스에 포함됩니다. JavaScript 인벤토리는 정확한 package-lock v3의 루트 런타임 종속성, 종속성, 선택적 종속성 및 피어 종속성에서 package-lock node_modules 해석을 사용해 결정론적으로 도출한 완전한 660개 런타임 클로저입니다.',
      '잠금 메타데이터에는 이 항목들의 저장소 또는 저작권 필드가 기록되어 있지 않습니다. “Not recorded”는 명시적이며 어떤 값도 추론하지 않았습니다. 해석된 소스 아카이브는 저장소 메타데이터와 별개입니다. 누락되거나 식별되지 않은 라이선스는 없으며, 다른 명명된 파일에 라이선스를 위임하는 항목도 없습니다. 세 개의 복수 라이선스 식은 정확히 보존됩니다. react-native-blob-util 및 react-native-track-player에는 로컬 패치가 적용되지만 업스트림 라이선스는 계속 식별됩니다.',
      '이 JavaScript 클로저는 바이너리에서 도출한 네이티브 인벤토리가 아닙니다. 최종 iOS 및 Android 스토어 바이너리는 스토어 출시 전에 재생성하고 검토한 네이티브 종속성/라이선스 보고서가 필요합니다. 이 문서는 네이티브 완전성을 주장하지 않습니다.',
      'Adaivo가 작성한 음악, 법률 문서, 코드 및 브랜드 자료는 오픈 소스가 아니며 이 고지로 라이선스되지 않습니다.',
    ],
    headings: [
      '## 런타임 JavaScript 인벤토리',
      '## 라이선스 본문 및 고지',
      '## 네이티브 릴리스 게이트',
    ],
    paragraphs: [
      '각 인벤토리 행의 정확한 표현이 적용됩니다. 복수 라이선스 표현의 경우 사용할 수 있는 각 선택 항목이 아래에 연결되어 있습니다. 저작권과 귀속 표시는 각 업스트림 작성자 및 기여자에게 귀속됩니다.',
      '식별 가능한 커밋 입력에는 React Native 및 Hermes 계열, AppAuth 및 Google 지원 라이브러리, Nitro/OpenIAP 구성 요소, Yoga 및 OpenSSL-Universal이 포함됩니다. Android 테스트 전용 종속성은 커밋된 Gradle 구성으로 제외됩니다. 이 요약은 최종 서명된 바이너리에서 생성되는 고지를 대체하지 않습니다. 스토어 출시 전에는 네이티브 바이너리 기반 보고서가 계속 필요합니다.',
    ],
  },
  'zh-Hant-HK': {
    scope: [
      '## 範圍',
      '本通知適用於以 Adaivo Music 提交版本 c810e47c83771fafea1366a6a58d4762c553b751 建立的現行版本。JavaScript 清單涵蓋完整的 660 項執行時依賴閉包；該清單以確定方式，按照 package-lock 的 node_modules 解析規則，從指定 package-lock v3 所列的根層級執行時依賴項、一般依賴項、可選依賴項及對等依賴項（peerDependencies）產生。',
      '鎖定檔案沒有記錄這些項目的程式碼庫或版權資料欄。「Not recorded」是明確記錄，我們沒有推斷任何值。解析所得的源碼壓縮檔案與程式碼庫元數據分開記錄。所有項目的授權均已識別，亦沒有項目將其授權資料指向另一個具名檔案。三個多重授權表述均按原文保留。react-native-blob-util 及 react-native-track-player 已套用本地修補；其上游授權仍有明確記錄。',
      '此 JavaScript 閉包並非按二進制檔案產生的原生依賴項清單。最終 iOS 及 Android 商店二進制檔案在商店推出前，必須重新產生並審核原生依賴項及授權報告。本文件不聲稱已涵蓋全部原生依賴項。',
      'Adaivo 創作的音樂、法律文本、程式碼及品牌資料並非開放源碼，亦不因本通知而獲授權。',
    ],
    headings: [
      '## 執行時 JavaScript 清單',
      '## 許可文本及通知',
      '## 原生發布門檻',
    ],
    paragraphs: [
      '每個清單條目中的精確表述具有約束力。對於多重許可表述，下方已連結每個可用選項。版權及署名仍歸各上游作者及貢獻者所有。',
      '可識別的已提交輸入包括 React Native 及 Hermes 系列、AppAuth 及 Google 支援程式庫、Nitro/OpenIAP 元件、Yoga 及 OpenSSL-Universal。Android 僅供測試的依賴項已由已提交的 Gradle 設定排除。本摘要不能取代從最終已簽署二進制檔案產生的通知；在商店發布前，仍必須提供由原生二進制檔案產生的報告。',
    ],
  },
};

const spdxNoticeLinks = [
  '- 0BSD: https://spdx.org/licenses/0BSD.html',
  '- Apache-2.0: https://spdx.org/licenses/Apache-2.0.html',
  '- BSD-2-Clause: https://spdx.org/licenses/BSD-2-Clause.html',
  '- BSD-3-Clause: https://spdx.org/licenses/BSD-3-Clause.html',
  '- BlueOak-1.0.0: https://spdx.org/licenses/BlueOak-1.0.0.html',
  '- CC-BY-4.0: https://spdx.org/licenses/CC-BY-4.0.html',
  '- CC0-1.0: https://spdx.org/licenses/CC0-1.0.html',
  '- ISC: https://spdx.org/licenses/ISC.html',
  '- MIT: https://spdx.org/licenses/MIT.html',
  '- Python-2.0: https://spdx.org/licenses/Python-2.0.html',
  '- Unlicense: https://spdx.org/licenses/Unlicense.html',
];

for (const locale of locales) for (const document of documents) {
  const text = await source(locale, document);
  assert(text.startsWith(`# ${documentTitles[locale][document]}\n`),
    `${locale}/${document}: document title mismatch`);
  assert(text.includes(release), `${locale}/${document}: release mismatch`);
  assert(text.includes(effectiveDate), `${locale}/${document}: effective date mismatch`);
  if (locale === 'zh-Hans') {
    exactCount(text, `**发布版本：** ${release}`, `${locale}/${document}: primary release`);
    exactCount(text, `**生效日期：** ${effectiveDate}`, `${locale}/${document}: primary effective date`);
  } else {
    exactCount(text, `**Release:** ${release}`, `${locale}/${document}: primary release`);
    exactCount(text, `**Effective date:** ${effectiveDate}`, `${locale}/${document}: primary effective date`);
  }
  const marker = `**Document status:** ${draftStatus}`;
  const markerCount = text.split(marker).length - 1;
  const approvedMarker = `**Document status:** ${approvedStatus}`;
  const approvedMarkerCount = count(text, approvedMarker);
  const referenceMetadata = [
    `**Reference release:** ${release}`,
    `**Reference effective date:** ${effectiveDate}`,
    `**Target locale:** ${locale}`,
  ];
  if (draftLocales.has(locale)) {
    if (mode === 'draft-inventory') {
      exactCount(text, marker, `${locale}/${document}: draft status`);
      exactCount(text, draftWarnings[locale], `${locale}/${document}: draft warning`);
      for (const value of referenceMetadata) exactCount(text, value, `${locale}/${document}: draft reference metadata`);
      assert.equal(approvedMarkerCount, 0, `${locale}/${document}: draft must not carry approval marker`);
    } else {
      assert.equal(count(text, '**Document status:** DRAFT'), 0,
        `release_ready_rejected: ${locale}/${document} draft status remains`);
      for (const prefix of ['**Reference release:**', '**Reference effective date:**', '**Target locale:**']) {
        assert.equal(count(text, prefix), 0,
          `release_ready_rejected: ${locale}/${document} draft reference metadata remains`);
      }
      assert.equal(count(text, draftWarnings[locale]), 0,
        `release_ready_rejected: ${locale}/${document} unreviewed draft warning remains`);
      exactCount(text, approvedMarker,
        `release_ready_rejected: ${locale}/${document} explicit approval marker`);
      validateApprovedPreamble(text, locale, document);
    }
  } else {
    assert.equal(markerCount, 0, `${locale}/${document}: published source must not carry draft marker`);
    assert.equal(approvedMarkerCount, 0, `${locale}/${document}: published source must not carry approval marker`);
  }
  if (document === 'licenses' && draftLocales.has(locale)) {
    exactCount(text, runtimeInventory.sourceCommit, `${locale}/licenses: inventory source commit`);
    const draftInventoryRows = text
      .split('\n')
      .filter(line => line.startsWith(inventoryPrefix));
    assert.deepEqual(draftInventoryRows, englishInventoryRows,
      `${locale}/licenses: runtime inventory rows drifted`);
    assert.equal(draftInventoryRows.length, runtimeInventory.count,
      `${locale}/licenses: runtime inventory count mismatch`);
    const nativeCompletenessWarnings = {
      ja: '本書はネイティブ完全性を主張しません。',
      ko: '이 문서는 네이티브 완전성을 주장하지 않습니다.',
      'zh-Hant-HK': '本文件不聲稱已涵蓋全部原生依賴項。',
    };
    exactCount(text, nativeCompletenessWarnings[locale],
      `${locale}/licenses: native-binary completeness warning`);
    if (locale in localizedLicenseWrappers) {
      for (const scopeEntry of localizedLicenseWrappers[locale].scope) {
        exactCount(text, scopeEntry, `${locale}/licenses: localized scope wrapper`);
      }
      for (const heading of localizedLicenseWrappers[locale].headings) {
        exactCount(text, heading, `${locale}/licenses: localized wrapper heading`);
      }
      for (const paragraph of localizedLicenseWrappers[locale].paragraphs) {
        exactCount(text, paragraph, `${locale}/licenses: localized wrapper paragraph`);
      }
      assert.equal(count(text, '## Runtime JavaScript inventory'), 0,
        `${locale}/licenses: English inventory wrapper remains`);
      assert.equal(count(text, '## License texts and notices'), 0,
        `${locale}/licenses: English license wrapper remains`);
      assert.equal(count(text, '## Native release gate'), 0,
        `${locale}/licenses: English native wrapper remains`);
      assert.equal(count(text, '## Scope'), 0,
        `${locale}/licenses: English scope wrapper remains`);
      assert.deepEqual(text.split('\n').filter((line) => line.startsWith('- ') && line.includes('https://spdx.org/licenses/')),
        spdxNoticeLinks,
        `${locale}/licenses: SPDX/URL notice block drifted`);
    }
  }
  if (draftLocales.has(locale) && (document === 'terms' || document === 'privacy')) {
    validateTranslatedStructure(englishDocuments[document], text, locale, document);
  }
  for (const required of draftSemantics[`${locale}/${document}`] ?? []) {
    assert(text.includes(required), `${locale}/${document}: audited legal wording missing: ${required}`);
  }
  if (locale === 'ja' && document === 'privacy') {
    assert(!text.includes('取引、返金、不正、紛争、税務その他、法令が要求するか承認済みの目的のため合理的に必要な記録のみを保持します。'),
      'ja/privacy: superseded retention wording remains');
  }
}

if (mode === 'draft-inventory') {
  console.log('draft_content_inventory_ok: 5 locales × 3 documents; 9 unreviewed drafts; 660-entry licenses preserved');
} else {
  console.log('draft_content_release_ready_ok');
}

if (selfTest) {
  async function assertDraftInventoryRejectsMutation(name, mutate, expected) {
    const fixture = await mkdtemp(resolve(tmpdir(), `adaivo-legal-draft-${name}-`));
    try {
      await cp(resolve(root, 'content'), resolve(fixture, 'content'), {recursive: true});
      await cp(resolve(root, 'inventory'), resolve(fixture, 'inventory'), {recursive: true});
      for (const locale of draftLocales) for (const document of documents) {
        const source = resolve(fixture, 'content', locale, `${document}.md`);
        const text = await readFile(source, 'utf8');
        const firstSection = text.indexOf('\n## ');
        const title = text.match(/^# .+$/m)?.[0];
        assert.notEqual(firstSection, -1);
        assert(title);
        await writeFile(source, `${title}\n\n**Document status:** ${draftStatus}\n**Reference release:** ${release}\n**Reference effective date:** ${effectiveDate}\n**Target locale:** ${locale}\n\n${draftWarnings[locale]}\n\n**Release:** ${release}\n**Effective date:** ${effectiveDate}${text.slice(firstSection)}`);
      }
      const target = resolve(fixture, 'content', 'zh-Hant-HK', 'licenses.md');
      await writeFile(target, mutate(await readFile(target, 'utf8')));
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', fixture, '--mode', 'draft-inventory', '--release', release, '--effective-date', effectiveDate], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0, `${name}: draft inventory must reject wrapper drift`);
      assert.match(result.stderr, expected, `${name}: rejection reason mismatch`);
    } finally {
      await rm(fixture, {recursive: true, force: true});
    }
  }

  await assertDraftInventoryRejectsMutation(
    'scope',
    (text) => text.replace('## 範圍', '## Scope'),
    /localized scope wrapper/,
  );
  await assertDraftInventoryRejectsMutation(
    'spdx-url',
    (text) => text.replace('https://spdx.org/licenses/MIT.html', 'https://invalid.example/MIT.html'),
    /SPDX\/URL notice block drifted/,
  );
  console.log('draft_content_self_test_ok: scope and SPDX/URL wrapper drift rejected');
}
