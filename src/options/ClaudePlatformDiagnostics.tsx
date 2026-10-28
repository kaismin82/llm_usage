import { useEffect, useRef, useState } from 'preact/hooks';
import { createSafeFetch } from '../core/safe-fetch';
import { diagnoseClaudePlatform, DIAGNOSE_MAX_PAGES, type DiagnoseResult } from '../providers/claude-platform-diagnose';
import { topEntries } from '../providers/cost-summary';
import { diagnoseUsageExtras, type UsageExtras, type UsageSection } from '../providers/claude-platform-usage-diagnose';
import { estimateUsageCost, judgeToday, sumTokens, type UsageBucket } from '../providers/claude-platform-usage';
import type { ProviderContext } from '../providers/types';

const ORIGINS = ['https://api.anthropic.com/*'];

async function ensureHostPermission(): Promise<boolean> {
  try {
    if (await chrome.permissions.contains({ origins: ORIGINS })) return true;
    return await chrome.permissions.request({ origins: ORIGINS });
  } catch {
    return false;
  }
}

export const DIAGNOSTICS_SCROLL_HASH = '#claude-platform-diagnostics';
export const DIAGNOSTICS_RUN_HASH = '#claude-platform-diagnostics-run';

async function hasHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: ORIGINS });
  } catch {
    return false;
  }
}

const usd = (value: number): string =>
  '$' + (Math.abs(value) > 0 && Math.abs(value) < 0.01 ? value.toFixed(4) : value.toFixed(2));

function Group({ title, values }: { title: string; values: Record<string, number> }) {
  const { top, restCount, restUsd } = topEntries(values, 6);
  return (
    <div class="diag-group">
      <h4>{title}</h4>
      {top.length === 0 && <p class="diag-muted">없음</p>}
      {top.map(([key, value]) => (
        <div class="diag-row" key={key}><span class="diag-key" title={key}>{key}</span><span>{usd(value)}</span></div>
      ))}
      {restCount > 0 && <div class="diag-row diag-muted"><span>그 외 {restCount}개</span><span>{usd(restUsd)}</span></div>}
    </div>
  );
}

function Report({ result, displayedUsd }: { result: Extract<DiagnoseResult, { ok: true }>; displayedUsd?: number }) {
  const { params, pages, hasMore, summary } = result;
  const today = result.queriedAt.slice(0, 10);
  const todayBucket = summary.bucketTotals.find((bucket) => bucket.startingAt.slice(0, 10) === today);
  const latest = summary.bucketTotals.reduce<(typeof summary.bucketTotals)[number] | undefined>(
    (best, bucket) => (best === undefined || bucket.startingAt > best.startingAt ? bucket : best), undefined);
  const billedDays = Object.keys(summary.byDay).length;
  const todayLine = todayBucket === undefined
    ? '오늘(UTC ' + today + ') 버킷이 응답에 없습니다'
    : todayBucket.usd > 0
      ? '오늘(UTC ' + today + ') 버킷에 ' + usd(todayBucket.usd) + ' 포함'
      : '오늘(UTC ' + today + ') 버킷은 있으나 비어 있습니다 (데이터 지연 신호일 수 있음)';
  const days = Object.entries(summary.byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const diff = displayedUsd === undefined ? undefined : summary.totalUsd - displayedUsd;
  const last = summary.lastCostBucket;
  return (
    <div class="diag-report" data-testid="diag-report">
      <div class="diag-key-facts" data-testid="diag-key-facts">
        <div><span class="diag-label">조회 시각 (UTC)</span><strong data-testid="diag-queried">{result.queriedAt}</strong></div>
        <div>
          <span class="diag-label">마지막 비용 버킷 ending_at</span>
          <strong data-testid="diag-last-ending">{summary.lastCostBucket ? (summary.lastCostBucket.endingAt ?? '(응답에 없음)') : '비용이 있는 버킷 없음'}</strong>
        </div>
        <div>
          <span class="diag-label">가장 최근 날짜의 합계{latest ? ' (' + latest.startingAt.slice(0, 10) + ')' : ''}</span>
          <strong data-testid="diag-latest-day">{latest ? usd(latest.usd) : '버킷 없음'}</strong>
        </div>
        <div>
          <span class="diag-label">일 버킷 수 (비용 0인 날 포함)</span>
          <strong data-testid="diag-bucket-count">{summary.buckets}개 (비용 있는 날 {billedDays}개)</strong>
        </div>
      </div>
      <p class="diag-today" data-testid="diag-today">{todayLine}</p>
      <div class="diag-grid">
        <div><span class="diag-label">진단 합계 (UTC 월)</span><strong data-testid="diag-total">{usd(summary.totalUsd)}</strong></div>
        <div><span class="diag-label">현재 표시값</span><strong>{displayedUsd === undefined ? '없음' : usd(displayedUsd)}</strong></div>
        <div>
          <span class="diag-label">일치 여부</span>
          <strong data-testid="diag-match">
            {diff === undefined ? '비교할 표시값 없음' : Math.abs(diff) < 0.005 ? '일치' : '다름 (차이 ' + usd(Math.abs(diff)) + ')'}
          </strong>
        </div>
        <div>
          <span class="diag-label">마지막 비용 버킷</span>
          <strong>{last ? last.startingAt.slice(0, 10) + (last.endingAt ? ' ~ ' + last.endingAt.slice(0, 16) + 'Z' : '') : '비용이 있는 버킷 없음'}</strong>
        </div>
      </div>
      <p class="diag-params">
        요청: starting_at={params.startingAt} · ending_at={params.endingAt} · bucket_width={params.bucketWidth} · limit={params.limit} ·
        group_by={params.groupBy.join(',')} · 페이지 {pages}개 · 버킷 {summary.buckets}개 · 항목 {summary.items}개 ·
        has_more {hasMore ? '예 (페이지 한도 ' + DIAGNOSE_MAX_PAGES + '개로 잘렸을 수 있음)' : '아니오'}
      </p>
      <p class="diag-params" data-testid="diag-page-info">
        페이지 크기: 요청 limit={params.limit}, 페이지별 버킷 수 [{result.pageSizes.join(', ')}] · 응답 최상위 필드: {result.responseKeys.join(', ') || '없음'}
      </p>
      <h4>일별 합계 (UTC)</h4>
      <div class="diag-days">
        {days.length === 0 && <p class="diag-muted">비용이 기록된 날이 없습니다</p>}
        {days.map(([day, value]) => (
          <div class="diag-row" key={day}><span>{day}</span><span>{usd(value)}</span></div>
        ))}
      </div>
      <div class="diag-groups">
        <Group title="비용 종류별" values={summary.byCostType} />
        <Group title="모델별" values={summary.byModel} />
        <Group title="워크스페이스별" values={summary.byWorkspace} />
      </div>
      <p class="note">
        웹 콘솔 숫자와 비교하는 방법: 콘솔 Cost 페이지에서 같은 UTC 월, 같은 조직, 전체 워크스페이스를 선택해 합계를 비교하세요.
        이 조회에는 Priority Tier 비용이 포함되지 않습니다(공식 문서 명시). 사용량은 약 5분 늦게 반영됩니다. 콘솔이 다른 시간대의
        날짜 경계나 크레딧 잔액을 보여 주면 값이 다를 수 있습니다. 위 표는 같은 요청의 날짜·종류별 분해이므로 어느 날, 어느 종류에서
        갈라지는지 확인할 수 있습니다.
      </p>
    </div>
  );
}

const count = (value: number): string => value.toLocaleString('en-US');

function UsageTable({ title, buckets, hourly }: { title: string; buckets: UsageBucket[]; hourly: boolean }) {
  const rows = buckets.flatMap((bucket) => bucket.rows.map((row) => ({ bucket, row })));
  return (
    <div class="diag-usage-table">
      <h4>{title}</h4>
      {rows.length === 0 ? <p class="diag-muted">토큰 사용 기록 없음</p> : (
        <table class="diag-table">
          <thead><tr><th>{hourly ? '시각(UTC)' : '날짜(UTC)'}</th><th>모델</th><th>uncached 입력</th><th>캐시 읽기</th><th>캐시 쓰기</th><th>출력</th></tr></thead>
          <tbody>
            {rows.map(({ bucket, row }, index) => (
              <tr key={index}>
                <td>{hourly ? bucket.startingAt.slice(11, 16) : bucket.startingAt.slice(0, 10)}</td>
                <td title={row.model}>{row.model}</td>
                <td>{count(row.uncached)}</td><td>{count(row.cacheRead)}</td><td>{count(row.cache5m + row.cache1h)}</td><td>{count(row.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsageSectionView({ title, section, hourly, testId }: { title: string; section: UsageSection; hourly: boolean; testId: string }) {
  if (!section.ok) return <div data-testid={testId}><h4>{title}</h4><p class="diag-note">{section.message}</p></div>;
  return (
    <div data-testid={testId}>
      <UsageTable title={title} buckets={section.buckets} hourly={hourly} />
      <p class="diag-params">
        요청: {section.params} · 페이지 {section.pages}개 · 버킷 {section.buckets.length}개 · has_more {section.hasMore ? '예' : '아니오'} · 응답 필드: {section.responseKeys.join(', ')}
      </p>
    </div>
  );
}

function UsagePanel({ extras, cost }: { extras: UsageExtras; cost: Extract<DiagnoseResult, { ok: true }> }) {
  const todayTokens = extras.usageToday.ok ? sumTokens(extras.usageToday.buckets) : undefined;
  const costBucket = cost.summary.bucketTotals.find((bucket) => bucket.startingAt.slice(0, 10) === extras.today);
  const estimate = extras.usageToday.ok ? estimateUsageCost(extras.usageToday.buckets) : undefined;
  return (
    <div class="diag-usage" data-testid="diag-usage">
      <h4>토큰 사용량 보고서 (usage_report/messages) 와 비교</h4>
      <p class="diag-today" data-testid="diag-usage-verdict">{judgeToday(todayTokens, costBucket)}</p>
      <h4>cost_report ending_at 비교 (읽기 전용 3회)</h4>
      <div class="diag-probes" data-testid="diag-probes">
        {extras.probes.map((probe) => (
          <div class="diag-row" key={probe.label}>
            <span>{probe.label} · ending_at={probe.endingAt}</span>
            <span>
              {probe.ok
                ? '버킷 ' + probe.buckets + '개 · 마지막 ' + (probe.lastStartingAt?.slice(0, 10) ?? '없음') + ' · 오늘 ' + (probe.includesToday ? '포함' : '미포함') + ' · ' + usd(probe.totalUsd)
                : probe.message}
            </span>
          </div>
        ))}
      </div>
      <UsageSectionView title={'오늘(UTC ' + extras.today + ') 시간대별 토큰'} section={extras.usageToday} hourly testId="diag-usage-today" />
      <UsageSectionView title="이번 달 일별 토큰" section={extras.usageMonth} hourly={false} testId="diag-usage-month" />
      {estimate && (
        <div class="diag-estimate" data-testid="diag-estimate">
          <h4>오늘 토큰 × 단가 추정액 (추정 · 패널 값 아님)</h4>
          {estimate.lines.length === 0 && <p class="diag-muted">오늘 토큰 사용 기록이 없어 추정하지 않습니다</p>}
          {estimate.lines.map((line, index) => (
            <p class="diag-params" key={index}>
              <strong>{line.model}</strong>{' '}
              {line.kind === 'estimated'
                ? '(' + line.priceLabel + ') 추정 ' + usd(line.usd) + ' = ' + line.formula
                : line.reason + ' (토큰 ' + count(line.tokens.uncached + line.tokens.cacheRead + line.tokens.cache5m + line.tokens.cache1h + line.tokens.output) + '개)'}
            </p>
          ))}
          {estimate.webSearchRequests > 0 && (
            <p class="diag-muted">웹 검색 {count(estimate.webSearchRequests)}회는 토큰 비용이 아니라 추정에서 제외했습니다.</p>
          )}
          <p class="diag-today">추정 합계 {usd(estimate.totalUsd)} (추정, 청구액 아님)</p>
          <p class="diag-muted">단가: platform.claude.com/docs/en/about-claude/pricing 2026-10-28 확인, 표준 티어·global·standard speed 가정, MTok = 100만 토큰. 모델 ID는 공식 가격표의 모델 이름에서 유추했습니다.</p>
        </div>
      )}
    </div>
  );
}

export function ClaudePlatformDiagnostics(props: {
  apiKey: string;
  displayedUsd?: number;
  get?: ProviderContext['get'];
  ensurePermission?: () => Promise<boolean>;
  /** Read-only permission check used by the automatic run; it never prompts. */
  hasPermission?: () => Promise<boolean>;
  /** Run once on load (options.html#claude-platform-diagnostics-run) when permission and key already exist. */
  autoRun?: boolean;
  now?: () => Date;
}) {
  const [running, setRunning] = useState(false);
  const [extras, setExtras] = useState<UsageExtras | undefined>();
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Extract<DiagnoseResult, { ok: true }> | undefined>();

  const run = async (auto = false) => {
    setMessage('');
    setResult(undefined);
    setExtras(undefined);
    if (!props.apiKey.trim()) {
      setMessage(auto ? '권한/키가 없어 자동 실행하지 않음' : '먼저 Admin API 키를 입력하세요');
      return;
    }
    setRunning(true);
    try {
      // The automatic run only checks an existing grant; it never opens a permission prompt.
      const granted = auto ? await (props.hasPermission ?? hasHostPermission)() : await (props.ensurePermission ?? ensureHostPermission)();
      if (!granted) {
        setMessage(auto ? '권한/키가 없어 자동 실행하지 않음' : 'api.anthropic.com 접근 권한이 필요합니다');
        return;
      }
      const apiKey = props.apiKey.trim();
      const now = (props.now ?? (() => new Date()))();
      const get = props.get ?? createSafeFetch();
      const outcome = await diagnoseClaudePlatform({ apiKey, now, get });
      if (outcome.ok) {
        // Token usage and ending_at comparisons only add context to a readable cost report.
        const found = await diagnoseUsageExtras({ apiKey, now, get });
        setExtras(found);
        setResult(outcome);
      } else setMessage(outcome.message);
    } finally {
      setRunning(false);
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!props.autoRun || autoStarted.current) return;
    autoStarted.current = true;
    void run(true);
  }, [props.autoRun]);

  return (
    <section class="diag" id="claude-platform-diagnostics" aria-label="Claude Platform 사용량 진단">
      <div class="diag-head">
        <button class="btn btn-test" type="button" data-action="claude-platform-diagnose" disabled={running} onClick={() => void run()}>
          {running ? '진단 중...' : '사용량 진단'}
        </button>
        <span class="diag-muted">클릭할 때만 실행되는 읽기 전용(GET) 조회입니다. 키는 화면에 표시하거나 기록하지 않습니다.</span>
      </div>
      {message && <p class="warning" role="status">{message}</p>}
      {result && <Report result={result} displayedUsd={props.displayedUsd} />}
      {result && extras && <UsagePanel extras={extras} cost={result} />}
    </section>
  );
}
