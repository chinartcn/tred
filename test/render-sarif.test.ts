import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderSarif } from '../src/index.js';
import type { VerifyReport } from '../src/index.js';

function emptyReport(): VerifyReport {
  return {
    ok: true, dir: 'src', scannedFiles: 3, files: [],
    issues: [], duplicatesWithin: [], duplicatesAcross: [], fingerprintMismatches: [],
  };
}

describe('renderSarif', function () {
  it('空 report：合法 SARIF 2.1.0，results=[]', function () {
    const sarif = JSON.parse(renderSarif(emptyReport()));
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].results.length, 0);
    assert.equal(sarif.runs[0].tool.driver.name, 'tred');
  });

  it('有 issue：results 含 ruleId + level + locations', function () {
    const r = emptyReport();
    r.ok = false;
    r.issues = [{ level: 'error', code: 'ORPHAN_START', file: 'a.ts', line: 5, message: '有 START 无 END' }];
    const sarif = JSON.parse(renderSarif(r, { version: '1.1.0' }));
    const run = sarif.runs[0];
    assert.equal(run.tool.driver.version, '1.1.0');
    assert.equal(run.results.length, 1);
    const res = run.results[0];
    assert.equal(res.ruleId, 'TRED_ORPHAN_START');
    assert.equal(res.level, 'error');
    assert.equal(res.message.text, '有 START 无 END');
    assert.equal(res.locations[0].physicalLocation.artifactLocation.uri, 'a.ts');
    assert.equal(res.locations[0].physicalLocation.region.startLine, 5);
  });

  it('rules 只包含用到的 code', function () {
    const r = emptyReport();
    r.issues = [
      { level: 'error', code: 'ORPHAN_START', file: 'a.ts', line: 1, message: 'x' },
      { level: 'warning', code: 'DUPLICATE_ACROSS', message: 'y' },
    ];
    const sarif = JSON.parse(renderSarif(r));
    const ruleIds = sarif.runs[0].tool.driver.rules.map((x: { id: string }) => x.id);
    assert.ok(ruleIds.indexOf('TRED_ORPHAN_START') >= 0);
    assert.ok(ruleIds.indexOf('TRED_DUPLICATE_ACROSS') >= 0);
    assert.equal(ruleIds.indexOf('TRED_FP_MISMATCH'), -1);
  });

  it('无 file/line 的 issue 不崩', function () {
    const r = emptyReport();
    r.issues = [{ level: 'warning', code: 'DUPLICATE_ACROSS', message: 'no location' }];
    const sarif = JSON.parse(renderSarif(r));
    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, '');
  });

  it('JSON 可序列化 + informationUri 可配', function () {
    const sarif = JSON.parse(renderSarif(emptyReport(), { informationUri: 'https://example.com/tred' }));
    assert.equal(sarif.runs[0].tool.driver.informationUri, 'https://example.com/tred');
  });
});
