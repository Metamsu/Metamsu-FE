import { useEffect, useRef, useState } from "react";
import { api, ApiError, message } from "./api";
import {
  Empty,
  ErrorBox,
  Loading,
  QuestionMeta,
  TagFilter,
} from "./components";
import { useResource } from "./hooks";
import { ReviewForm, ReviewSummary } from "./QuestionReview";
import type { Question, QuestionReview, Tag } from "./types";

export function Manage({
  tags,
  revision,
  refresh,
}: {
  tags: Tag[];
  revision: number;
  refresh: () => void;
}) {
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<Question>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [stale, setStale] = useState(false);
  const resource = useResource<Question[]>(
    `/questions?view=manage${tag ? `&tagId=${encodeURIComponent(tag)}` : ""}`,
    revision,
  );
  const busyRef = useRef(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  // Reviews saved since the list loaded, so judging a question does not reload the whole list.
  const [reviewed, setReviewed] = useState<
    Record<string, QuestionReview | null>
  >({});
  const [reviewTick, setReviewTick] = useState(0);
  useEffect(() => setReviewed({}), [resource.data]);
  const reviewOf = (question: Question) =>
    question.id in reviewed ? reviewed[question.id] : (question.review ?? null);
  const visible = resource.data?.filter(
    (question) => !unreviewedOnly || !reviewOf(question),
  );
  async function remove(question: Question) {
    if (
      busyRef.current ||
      !window.confirm(
        "이 문제를 삭제할까요? 보관함, 복습 및 통계에서 제외됩니다.",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await api(`/questions/${question.id}`, { method: "DELETE" });
      if (editing?.id === question.id) setEditing(undefined);
      setSuccess("문제가 삭제되었습니다.");
      refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busyRef.current || stale) return;
    if (
      !editing.text.trim() ||
      editing.options.some((option) => !option.trim()) ||
      editing.correctIndex == null ||
      !editing.explanation?.trim() ||
      !editing.tagId
    ) {
      setError("문제, 모든 선택지, 정답, 개념 및 해설을 입력해 주세요.");
      return;
    }
    if (
      !window.confirm(
        "수정하면 이 문제의 기존 풀이 기록과 복습 일정이 초기화됩니다. 저장할까요?",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await api(`/questions/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          text: editing.text.trim(),
          options: editing.options.map((option) => option.trim()),
          correctIndex: editing.correctIndex,
          tagId: editing.tagId,
          difficulty: editing.difficulty,
          explanation: editing.explanation.trim(),
          version: editing.version,
        }),
      });
      setEditing(undefined);
      setSuccess(
        "문제가 수정되었습니다. 기존 풀이·복습 기록은 초기화되었습니다.",
      );
      refresh();
    } catch (error) {
      setError(message(error));
      if (error instanceof ApiError && error.status === 409) setStale(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function edit(question: Question) {
    setEditing({ ...question, options: [...question.options] });
    setError(undefined);
    setSuccess(undefined);
    setStale(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR QUESTION LIBRARY</span>
          <h1>문제 보관함</h1>
          <p>생성된 내용을 검토하고, 정확한 나만의 학습 자료로 다듬으세요.</p>
        </div>
        <a href="#upload" className="button secondary">
          ＋ 문제 추가
        </a>
      </div>
      <ErrorBox error={error} />
      {success && (
        <div role="status" className="notice success">
          {success}
        </div>
      )}
      {editing ? (
        <section className="card edit-card">
          <h2>문제 수정</h2>
          <div className="notice">
            저장 시 이 문제의 기존 풀이 기록과 복습 일정이 초기화됩니다. 실제
            출처 페이지는 수정하지 않습니다.
          </div>
          <QuestionMeta question={editing} tags={tags} />
          <form onSubmit={save}>
            <fieldset disabled={busy || stale}>
              <label>
                문제
                <textarea
                  required
                  value={editing.text}
                  onChange={(e) =>
                    setEditing({ ...editing, text: e.target.value })
                  }
                />
              </label>
              {editing.options.map((option, index) => (
                <label key={index}>
                  선택지 {index + 1}
                  <input
                    required
                    value={option}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        options: editing.options.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <div className="form-row">
                <label>
                  정답
                  <select
                    value={editing.correctIndex ?? ""}
                    required
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        correctIndex: Number(e.target.value),
                      })
                    }
                  >
                    <option value="" disabled>
                      정답 선택
                    </option>
                    {editing.options.map((_, index) => (
                      <option value={index} key={index}>
                        선택지 {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  개념
                  <select
                    required
                    value={editing.tagId}
                    onChange={(e) =>
                      setEditing({ ...editing, tagId: e.target.value })
                    }
                  >
                    {tags.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  난이도
                  <select
                    value={editing.difficulty}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        difficulty: e.target.value as Question["difficulty"],
                      })
                    }
                  >
                    <option value="EASY">기초</option>
                    <option value="MEDIUM">보통</option>
                    <option value="HARD">심화</option>
                  </select>
                </label>
              </div>
              <label>
                해설
                <textarea
                  required
                  value={editing.explanation || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, explanation: e.target.value })
                  }
                />
              </label>
            </fieldset>
            {stale && (
              <div className="notice">
                다른 곳에서 문제가 바뀌었습니다 (409). 편집을 닫고 새로고침한 뒤
                다시 수정하세요.
              </div>
            )}
            <div className="actions">
              <button type="submit" disabled={busy || stale}>
                {busy ? "저장 중…" : "초기화 확인 후 저장"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="secondary"
                onClick={() => {
                  setEditing(undefined);
                  setError(undefined);
                  if (stale) resource.reload();
                }}
              >
                편집 닫기
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <ReviewSummary revision={revision + reviewTick} />
          <div className="section-heading">
            <span className="muted">
              {visible ? `${visible.length}개의 문제` : "나의 문제"}
            </span>
            <div className="manage-filters">
              <label className="filter check">
                <input
                  type="checkbox"
                  checked={unreviewedOnly}
                  onChange={(e) => setUnreviewedOnly(e.target.checked)}
                />
                아직 평가 안 한 문항만 보기
              </label>
              <TagFilter tags={tags} value={tag} onChange={setTag} />
            </div>
          </div>
          <ErrorBox error={resource.error} retry={resource.reload} />
          {resource.loading && <Loading />}
          {resource.data &&
            visible &&
            (resource.data.length ? (
              <div className="question-list">
                {visible.length === 0 && (
                  <p className="muted">평가하지 않은 문항이 없습니다.</p>
                )}
                {visible.map((question) => (
                  <article className="card" key={question.id}>
                    <QuestionMeta question={question} tags={tags} />
                    <h3>{question.text}</h3>
                    <ol className="manage-options">
                      {question.options.map((option, index) => (
                        <li key={index}>
                          {option}
                          {question.correctIndex === index && (
                            <span className="pill">정답</span>
                          )}
                        </li>
                      ))}
                    </ol>
                    <details>
                      <summary>해설 확인</summary>
                      <p className="explanation">
                        {question.explanation || "해설이 없습니다."}
                      </p>
                    </details>
                    <ReviewForm
                      key={`${question.id}-${question.version}`}
                      question={question}
                      review={reviewOf(question)}
                      onChange={(review) => {
                        setReviewed((current) => ({
                          ...current,
                          [question.id]: review,
                        }));
                        setReviewTick((tick) => tick + 1);
                      }}
                    />
                    <div className="actions">
                      <button
                        className="secondary small"
                        disabled={busy}
                        onClick={() => edit(question)}
                      >
                        수정
                      </button>
                      <button
                        className="danger small"
                        disabled={busy}
                        onClick={() => remove(question)}
                      >
                        삭제
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="보관된 문제가 없어요">
                <p>PDF나 고정 데모로 첫 문제를 준비해 보세요.</p>
                <a href="#upload" className="button">
                  문제 생성하기
                </a>
              </Empty>
            ))}
        </>
      )}
    </>
  );
}
