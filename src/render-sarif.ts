import type { VerifyIssue, VerifyReport } from './types.js';

export interface SarifOptions {
  version?: string;
  informationUri?: string;
}

function ruleIdOf(code: string): string {
  return 'TRED_' + code;
}

interface RuleMeta {
  id: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  defaultLevel: 'error' | 'warning';
}

const RULES: RuleMeta[] = [
  {
    id: ruleIdOf('ORPHAN_START'),
    name: 'OrphanStart',
    shortDescription: 'Anchor START without matching END',
    fullDescription: 'A @TRED_START comment has no matching @TRED_END within the same file.',
    defaultLevel: 'error',
  },
  {
    id: ruleIdOf('ORPHAN_END'),
    name: 'OrphanEnd',
    shortDescription: 'Anchor END without matching START',
    fullDescription: 'A @TRED_END comment has no matching @TRED_START within the same file.',
    defaultLevel: 'error',
  },
  {
    id: ruleIdOf('DUPLICATE_WITHIN'),
    name: 'DuplicateAnchorWithinFile',
    shortDescription: 'Duplicate anchor name within a file',
    fullDescription: 'The same anchor name appears more than once in a single file.',
    defaultLevel: 'error',
  },
  {
    id: ruleIdOf('DUPLICATE_ACROSS'),
    name: 'DuplicateAnchorAcrossFiles',
    shortDescription: 'Duplicate anchor name across files',
    fullDescription: 'The same anchor name appears in more than one file. This may cause unintended matches.',
    defaultLevel: 'warning',
  },
  {
    id: ruleIdOf('FP_MISMATCH'),
    name: 'FingerprintMismatch',
    shortDescription: 'Fingerprint mismatch for same anchor',
    fullDescription: 'The same anchor name has different fingerprints across files, indicating out-of-sync versions.',
    defaultLevel: 'warning',
  },
];

function toLevel(l: 'error' | 'warning'): 'error' | 'warning' {
  return l;
}

export function renderSarif(report: VerifyReport, opts?: SarifOptions): string {
  const version = (opts && opts.version) || '0.0.0';
  const uri = (opts && opts.informationUri) || 'https://github.com/chinartcn/tred';

  // 按 code 聚合 issues，保证每个 ruleId 只出现一次
  const rulesUsed = new Set<string>();
  for (const issue of report.issues) rulesUsed.add(issue.code);

  const rules = RULES.filter((r) => rulesUsed.has(r.id.replace(/^TRED_/, ''))).map((r) => ({
    id: r.id,
    name: r.name,
    shortDescription: { text: r.shortDescription },
    fullDescription: { text: r.fullDescription },
    defaultConfiguration: { level: r.defaultLevel },
    helpUri: uri + '#rules',
  }));

  const results = report.issues.map((issue) => {
    const loc: Record<string, unknown> = {
      physicalLocation: {
        artifactLocation: {
          uri: issue.file || '',
          uriBaseId: '%SRCROOT%',
        },
      },
    };
    if (issue.line) {
      const pl = loc.physicalLocation as Record<string, unknown>;
      pl.region = { startLine: issue.line, startColumn: 1 };
    }
    return {
      ruleId: ruleIdOf(issue.code),
      level: toLevel(issue.level),
      message: { text: issue.message },
      locations: [loc],
    };
  });

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'tred',
            version: version,
            informationUri: uri,
            rules: rules,
          },
        },
        originalUriBaseIds: {
          '%SRCROOT%': {
            uri: report.dir ? report.dir + '/' : './',
          },
        },
        results: results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2) + '\n';
}
