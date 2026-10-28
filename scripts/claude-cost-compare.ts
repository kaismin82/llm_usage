// Compares the extension's Claude Platform monthly figure with what the Cost API reports per day,
// cost type, workspace and model, so the total can be checked against the Claude Console Cost page.
// Read-only GET through the extension allowlist. The key comes only from ANTHROPIC_ADMIN_KEY and is never printed.
//   PowerShell:  $env:ANTHROPIC_ADMIN_KEY = '<admin key>'; npm run claude-cost -- 2026-10
import { assertAllowed } from '../src/core/allowlist';
import { summarizeCostBuckets } from '../src/providers/cost-summary';

const usd = (value: number): string => '$' + value.toFixed(2);

function monthRange(arg: string | undefined): { start: Date; next: Date; label: string } {
  const now = new Date();
  const match = arg === undefined ? null : /^(\d{4})-(\d{2})$/.exec(arg);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  return { start, next, label: start.toISOString().slice(0, 7) };
}

function printGroup(title: string, values: Record<string, number>): void {
  console.log('\n' + title);
  for (const [key, value] of Object.entries(values).sort((a, b) => b[1] - a[1])) console.log('  ' + usd(value).padStart(10) + '  ' + key);
}

async function main(): Promise<void> {
  const key = process.env['ANTHROPIC_ADMIN_KEY'];
  if (!key) {
    console.error('Set ANTHROPIC_ADMIN_KEY (an Admin API key or an organization-scoped key) first.');
    process.exitCode = 1;
    return;
  }
  const { start, next, label } = monthRange(process.argv[2]);
  const buckets: unknown[] = [];
  let page: string | undefined;
  for (let request = 0; request < 10; request += 1) {
    const url = 'https://api.anthropic.com/v1/organizations/cost_report?starting_at=' + start.toISOString() +
      '&ending_at=' + next.toISOString() + '&bucket_width=1d&limit=31&group_by[]=description&group_by[]=workspace_id' +
      (page ? '&page=' + encodeURIComponent(page) : '');
    assertAllowed(url, 'GET');
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'error',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || typeof body !== 'object' || body === null) {
      const error = (body as { error?: { type?: string; message?: string } } | undefined)?.error;
      console.error('HTTP ' + response.status + (error ? ' ' + String(error.type) + ': ' + String(error.message) : ''));
      process.exitCode = 1;
      return;
    }
    const record = body as { data?: unknown; has_more?: boolean; next_page?: string | null };
    if (!Array.isArray(record.data)) {
      console.error('Unexpected response shape');
      process.exitCode = 1;
      return;
    }
    buckets.push(...record.data);
    if (record.has_more !== true || typeof record.next_page !== 'string') break;
    page = record.next_page;
  }
  const summary = summarizeCostBuckets(buckets);
  if (!summary) {
    console.error('Could not read the cost report as non-negative USD amounts; not printing a total.');
    process.exitCode = 1;
    return;
  }
  console.log('Cost API, UTC month ' + label + ': total ' + usd(summary.totalUsd) + ' over ' + buckets.length + ' daily buckets (' + summary.items + ' items)');
  printGroup('By day (UTC)', Object.fromEntries(Object.entries(summary.byDay).sort()));
  printGroup('By cost type', summary.byCostType);
  printGroup('By workspace', summary.byWorkspace);
  printGroup('By model', summary.byModel);
  console.log('\nNot included by this endpoint: Priority Tier costs (see the Usage and Cost API docs). Usage appears about 5 minutes late.');
  console.log('Compare the total with the Console Cost page for the same UTC month, all workspaces, same organization.');
}

await main();
