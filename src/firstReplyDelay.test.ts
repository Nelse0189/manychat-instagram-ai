import assert from "node:assert/strict";
import test from "node:test";
import { buildCloudTaskPayload, firstReplyTaskId } from "./cloudTasks.js";
import { FIRST_REPLY_DELAY_MAX_MS, firstReplyDelayMs } from "./firstReplyDelay.js";

test("the first reply delay is a random value from 0 through 10 minutes", () => {
  assert.equal(FIRST_REPLY_DELAY_MAX_MS, 10 * 60 * 1000);
  assert.equal(firstReplyDelayMs(() => 0), 0);
  assert.equal(firstReplyDelayMs(() => 0.999999999), FIRST_REPLY_DELAY_MAX_MS);
  assert.equal(firstReplyDelayMs(() => 0.5), 5 * 60 * 1000);
  for (let index = 0; index < 40; index += 1) {
    const delay = firstReplyDelayMs();
    assert.equal(Number.isInteger(delay), true);
    assert.ok(delay >= 0);
    assert.ok(delay <= FIRST_REPLY_DELAY_MAX_MS);
  }
});

test("the first reply is a Cloud Task at the due time, not a sleep in the webhook", () => {
  const dueAt = "2026-09-29T20:10:00.000Z";
  const payload = buildCloudTaskPayload({
    project: "arial-luxe-shop",
    location: "us-central1",
    queue: "shop-assistant-replies",
    target: "https://shop.example.run.app",
    subscriberId: "12345",
    dueAt,
  });
  const body = JSON.parse(payload.bodyText) as {
    task: { scheduleTime: string; httpRequest: { url: string; body: string } };
  };
  assert.equal(payload.scheduleTime, dueAt);
  assert.equal(body.task.scheduleTime, dueAt);
  assert.equal(body.task.httpRequest.url, "https://shop.example.run.app/tasks/first-reply");
  assert.equal(firstReplyTaskId("12345"), "first-12345");
  assert.equal(
    JSON.parse(Buffer.from(body.task.httpRequest.body, "base64").toString("utf8")).subscriberId,
    "12345",
  );
  assert.equal(JSON.stringify(body).includes("setTimeout"), false);
});
