import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Question, QuestionReview, ReviewSummary } from "./types";

const base: Question = {
  id: "q1",
  text: "프로세스 간 CPU 실행을 바꾸는 작업은 무엇인가요?",
  options: ["문맥 교환", "페이지 교체", "디스크 포맷", "파일 압축"],
  tagId: "process",
  difficulty: "EASY",
  sourceStartPage: null,
  sourceEndPage: null,
  documentName: null,
  mode: "DEMO",
  version: 1,
  box: 0,
  dueDate: null,
  latestCorrect: null,
  correctIndex: 0,
  explanation: "문맥 교환은 실행 상태를 저장하고 복원하는 작업입니다.",
  review: null,
};
const second: Question = { ...base, id: "q2", text: "교착 상태란 무엇인가요?" };

const reply = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function mockServer(
  overrides?: (path: string, init: RequestInit) => Response | undefined,
) {
  const reviews: Record<string, QuestionReview | null> = {};
  const summary = (): ReviewSummary => {
    const saved = Object.values(reviews).filter(
      (review): review is QuestionReview => review != null,
    );
    const rate = (count: number) =>
      saved.length ? Math.round((100 * count) / saved.length) : 0;
    const usable = saved.filter((review) => review.usable).length;
    const tagged = saved.filter((review) => review.tagCorrect).length;
    return {
      questionCount: 2,
      reviewedCount: saved.length,
      usableCount: usable,
      usableRate: rate(usable),
      tagCorrectCount: tagged,
      tagCorrectRate: rate(tagged),
      issues: {
        WRONG_ANSWER: 0,
        AMBIGUOUS: saved.filter((review) => review.issueType === "AMBIGUOUS")
          .length,
        OFF_TOPIC: 0,
        TOO_EASY: 0,
        DUPLICATE: 0,
        OTHER: 0,
      },
      targetUsableRate: 60,
      targetTagCorrectRate: 80,
      usableTargetMet: saved.length ? rate(usable) >= 60 : null,
      tagTargetMet: saved.length ? rate(tagged) >= 80 : null,
    };
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, options: RequestInit = {}) => {
      const path = String(input);
      const override = overrides?.(path, options);
      if (override) return override;
      if (path === "/api/config")
        return reply({
          liveEnabled: false,
          courseName: "운영체제",
          timezone: "Asia/Seoul",
        });
      if (path === "/api/learners")
        return reply({ token: "server-token" }, 201);
      if (path === "/api/tags")
        return reply([{ id: "process", name: "프로세스" }]);
      if (path === "/api/questions?view=manage")
        return reply(
          [base, second].map((question) => ({
            ...question,
            review: reviews[question.id] ?? null,
          })),
        );
      if (path === "/api/reviews/summary") return reply(summary());
      const match = path.match(/^\/api\/questions\/(q\d)\/review$/);
      if (match && options.method === "PUT") {
        const body = JSON.parse(options.body as string);
        reviews[match[1]] = {
          usable: body.usable,
          tagCorrect: body.tagCorrect,
          issueType: body.issueType,
          memo: body.memo,
          updatedAt: "2026-11-14T00:00:00Z",
        };
        return reply({ ...base, id: match[1], review: reviews[match[1]] });
      }
      if (match && options.method === "DELETE") {
        reviews[match[1]] = null;
        return reply(null, 204);
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const card = (text: string) =>
  within(screen.getByRole("heading", { name: text }).closest("article")!);
const summaryPanel = () =>
  within(screen.getByRole("region", { name: "문항 품질 평가 요약" }));

describe("question quality review", () => {
  it("saves a review without reloading the list, refreshes the summary, filters and clears", async () => {
    window.location.hash = "manage";
    const fetchMock = mockServer();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(base.text);
    expect(await summaryPanel().findByText("0 / 2")).toBeVisible();
    expect(summaryPanel().queryByText(/목표 (달성|미달)/)).toBeNull();

    const first = card(base.text);
    expect(first.getByText("미평가")).toBeVisible();
    const save = first.getByRole("button", { name: "평가 저장" });
    expect(save).toBeDisabled();
    await user.click(first.getByRole("radio", { name: "사용 불가" }));
    expect(save).toBeDisabled();
    await user.click(first.getByRole("radio", { name: "태그 맞음" }));
    await user.selectOptions(
      first.getByRole("combobox", { name: "사용 불가 사유" }),
      "AMBIGUOUS",
    );
    await user.type(
      first.getByRole("textbox", { name: "메모" }),
      " 보기가 모호함 ",
    );
    await user.click(save);

    expect(await first.findByText("평가 완료 · 사용 불가")).toBeVisible();
    const put = fetchMock.mock.calls.find(
      ([, options]) => options?.method === "PUT",
    )!;
    expect(String(put[0])).toBe("/api/questions/q1/review");
    expect(JSON.parse(put[1]!.body as string)).toEqual({
      usable: false,
      tagCorrect: true,
      issueType: "AMBIGUOUS",
      memo: "보기가 모호함",
      version: 1,
    });
    expect(new Headers(put[1]!.headers).get("X-Learner-Token")).toBe(
      "server-token",
    );
    expect(await summaryPanel().findByText("1 / 2")).toBeVisible();
    expect(summaryPanel().getByText("0%")).toBeVisible();
    expect(summaryPanel().getByText("100%")).toBeVisible();
    expect(summaryPanel().getByText("목표 미달")).toBeVisible();
    expect(summaryPanel().getByText("목표 달성")).toBeVisible();
    expect(
      summaryPanel().getByText("사용 불가 사유: 문제·보기 모호 1건"),
    ).toBeVisible();
    // Judging a question must not refetch the whole list (it would lose the reviewer's place).
    expect(
      fetchMock.mock.calls.filter(
        ([path]) => String(path) === "/api/questions?view=manage",
      ),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("checkbox", { name: "아직 평가 안 한 문항만 보기" }),
    );
    expect(screen.queryByRole("heading", { name: base.text })).toBeNull();
    expect(screen.getByRole("heading", { name: second.text })).toBeVisible();
    expect(screen.getByText("1개의 문제")).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", { name: "아직 평가 안 한 문항만 보기" }),
    );

    await user.click(
      card(base.text).getByRole("button", { name: "평가 취소" }),
    );
    expect(await card(base.text).findByText("미평가")).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([path, options]) =>
          String(path) === "/api/questions/q1/review" &&
          options?.method === "DELETE",
      ),
    ).toBe(true);
    expect(await summaryPanel().findByText("0 / 2")).toBeVisible();
  });

  it("sends no issue type for a usable question and reports a stale version", async () => {
    window.location.hash = "manage";
    let conflict = false;
    const fetchMock = mockServer((path, options) =>
      conflict && path.endsWith("/review") && options.method === "PUT"
        ? reply(
            {
              code: "CONFLICT",
              message: "문제가 변경되었습니다. 새로고침해 주세요.",
            },
            409,
          )
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(second.text);
    const target = card(second.text);
    await user.click(target.getByRole("radio", { name: "사용 가능" }));
    await user.click(target.getByRole("radio", { name: "태그 틀림" }));
    expect(
      target.queryByRole("combobox", { name: "사용 불가 사유" }),
    ).toBeNull();
    await user.click(target.getByRole("button", { name: "평가 저장" }));
    expect(await target.findByText("평가 완료 · 사용 가능")).toBeVisible();
    const put = fetchMock.mock.calls.find(
      ([, options]) => options?.method === "PUT",
    )!;
    expect(JSON.parse(put[1]!.body as string)).toMatchObject({
      usable: true,
      tagCorrect: false,
      issueType: null,
      memo: null,
    });

    conflict = true;
    await user.click(target.getByRole("button", { name: "평가 저장" }));
    expect(
      await target.findByText(
        "평가를 저장하지 못했습니다: 문제가 변경되었습니다. 새로고침해 주세요.",
      ),
    ).toBeVisible();
  });

  it("downloads the CSV with the learner token because a plain link cannot send it", async () => {
    window.location.hash = "manage";
    const fetchMock = mockServer((path) =>
      path === "/api/reviews/export.csv"
        ? new Response("question_id\r\n", {
            headers: { "Content-Type": "text/csv" },
          })
        : undefined,
    );
    const createObjectURL = vi.fn(() => "blob:recall");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(base.text);
    await user.click(screen.getByRole("button", { name: "CSV 내려받기" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const request = fetchMock.mock.calls.find(
      ([path]) => String(path) === "/api/reviews/export.csv",
    )!;
    expect(new Headers(request[1]!.headers).get("X-Learner-Token")).toBe(
      "server-token",
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recall");
    click.mockRestore();
  });
});
