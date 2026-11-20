import { useEffect, useRef, useState } from "react";
import { api, download, message } from "./api";
import { useResource } from "./hooks";
import type {
  IssueType,
  Question,
  QuestionReview,
  ReviewSummary as Summary,
} from "./types";

export const issueLabel: Record<IssueType, string> = {
  WRONG_ANSWER: "정답 오류",
  AMBIGUOUS: "문제·보기 모호",
  OFF_TOPIC: "강의 내용과 무관",
  TOO_EASY: "너무 쉬움",
  DUPLICATE: "중복 문항",
  OTHER: "기타",
};

export function ReviewSummary({ revision }: { revision: number }) {
  const resource = useResource<Summary>("/reviews/summary", revision);
  // Keep showing the previous numbers while a refresh is in flight.
  const [last, setLast] = useState<Summary>();
  useEffect(() => {
    if (resource.data) setLast(resource.data);
  }, [resource.data]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const data = resource.data ?? last;
  async function exportCsv() {
    setDownloading(true);
    setError(undefined);
    try {
      await download("/reviews/export.csv", "recall-reviews.csv");
    } catch (error) {
      setError(message(error));
    } finally {
      setDownloading(false);
    }
  }
  const issues = data
    ? (Object.entries(data.issues) as [IssueType, number][]).filter(
        ([, count]) => count > 0,
      )
    : [];
  return (
    <section className="card review-summary" aria-label="문항 품질 평가 요약">
      <div className="section-heading">
        <div>
          <h2>문항 품질 평가</h2>
          <p>
            각 문항을 실제로 쓸 수 있는지, 개념 태그가 맞는지 표시하면 여기에
            집계됩니다.
          </p>
        </div>
        <button
          className="secondary small"
          disabled={downloading}
          onClick={exportCsv}
        >
          {downloading ? "내려받는 중…" : "CSV 내려받기"}
        </button>
      </div>
      {error && <p className="muted">CSV를 내려받지 못했습니다: {error}</p>}
      {data ? (
        <>
          <div className="review-stats">
            <SummaryStat
              label="평가 진행률"
              value={`${data.reviewedCount} / ${data.questionCount}`}
              detail={
                data.questionCount
                  ? `${Math.round((100 * data.reviewedCount) / data.questionCount)}% 평가함`
                  : "문항 없음"
              }
            />
            <SummaryStat
              label="사용 가능 문항"
              value={data.reviewedCount ? `${data.usableRate}%` : "–"}
              detail={`목표 ${data.targetUsableRate}% 이상`}
              met={data.usableTargetMet}
            />
            <SummaryStat
              label="태그 일치"
              value={data.reviewedCount ? `${data.tagCorrectRate}%` : "–"}
              detail={`목표 ${data.targetTagCorrectRate}% 이상`}
              met={data.tagTargetMet}
            />
          </div>
          {issues.length > 0 && (
            <p className="muted review-issues">
              사용 불가 사유:{" "}
              {issues
                .map(([type, count]) => `${issueLabel[type]} ${count}건`)
                .join(" · ")}
            </p>
          )}
        </>
      ) : resource.error ? (
        <p className="muted">
          평가 요약을 불러오지 못했습니다.{" "}
          <button className="text-button" onClick={resource.reload}>
            요약 다시 불러오기
          </button>
        </p>
      ) : (
        <p className="muted">평가 요약을 불러오는 중…</p>
      )}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  detail,
  met,
}: {
  label: string;
  value: string;
  detail: string;
  met?: boolean | null;
}) {
  return (
    <div className="review-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>
        {detail}
        {met != null && (
          <span className={`pill ${met ? "" : "neutral"}`}>
            {met ? "목표 달성" : "목표 미달"}
          </span>
        )}
      </small>
    </div>
  );
}

export function ReviewForm({
  question,
  review,
  onChange,
}: {
  question: Question;
  review: QuestionReview | null;
  onChange: (review: QuestionReview | null) => void;
}) {
  const [usable, setUsable] = useState<boolean | undefined>(review?.usable);
  const [tagCorrect, setTagCorrect] = useState<boolean | undefined>(
    review?.tagCorrect,
  );
  const [issueType, setIssueType] = useState<IssueType | "">(
    review?.issueType ?? "",
  );
  const [memo, setMemo] = useState(review?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const busyRef = useRef(false);
  const path = `/questions/${question.id}/review`;
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const save = () =>
    run(async () => {
      const saved = await api<Question>(path, {
        method: "PUT",
        body: JSON.stringify({
          usable,
          tagCorrect,
          issueType: usable ? null : issueType || null,
          memo: memo.trim() || null,
          version: question.version,
        }),
      });
      onChange(saved.review ?? null);
    });
  const clear = () =>
    run(async () => {
      await api(path, { method: "DELETE" });
      setUsable(undefined);
      setTagCorrect(undefined);
      setIssueType("");
      setMemo("");
      onChange(null);
    });
  const choice = (
    legend: string,
    name: string,
    value: boolean | undefined,
    set: (value: boolean) => void,
    yes: string,
    no: string,
  ) => (
    <fieldset className="review-choice">
      <legend>{legend}</legend>
      {[true, false].map((option) => (
        <label key={String(option)}>
          <input
            type="radio"
            name={`${name}-${question.id}`}
            checked={value === option}
            onChange={() => set(option)}
          />
          {option ? yes : no}
        </label>
      ))}
    </fieldset>
  );
  return (
    <fieldset className="review-form" disabled={busy}>
      <legend>
        문항 평가{" "}
        <span className={`pill ${review ? "" : "neutral"}`}>
          {review
            ? `평가 완료 · ${review.usable ? "사용 가능" : "사용 불가"}`
            : "미평가"}
        </span>
      </legend>
      <div className="review-row">
        {choice(
          "이 문항을",
          "usable",
          usable,
          setUsable,
          "사용 가능",
          "사용 불가",
        )}
        {choice(
          "개념 태그가",
          "tag",
          tagCorrect,
          setTagCorrect,
          "태그 맞음",
          "태그 틀림",
        )}
      </div>
      {usable === false && (
        <div className="review-row">
          <label>
            사용 불가 사유
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as IssueType | "")}
            >
              <option value="">선택 안 함</option>
              {(Object.keys(issueLabel) as IssueType[]).map((type) => (
                <option key={type} value={type}>
                  {issueLabel[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            메모
            <input
              value={memo}
              maxLength={2000}
              placeholder="무엇이 문제인지 적어 두세요"
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && (
        <p className="review-error" role="status">
          평가를 저장하지 못했습니다: {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="small"
          disabled={usable === undefined || tagCorrect === undefined}
          onClick={save}
        >
          {busy ? "저장 중…" : "평가 저장"}
        </button>
        {review && (
          <button type="button" className="secondary small" onClick={clear}>
            평가 취소
          </button>
        )}
      </div>
    </fieldset>
  );
}
