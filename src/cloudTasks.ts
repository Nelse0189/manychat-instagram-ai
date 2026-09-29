import { config } from "./config.js";

export type ScheduledReply = {
  subscriberId: string;
  dueAt: string;
};

export type ReplyScheduler = {
  schedule(input: ScheduledReply): Promise<string>;
};

export function firstReplyTaskId(subscriberId: string): string {
  const cleaned = subscriberId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 480);
  return `first-${cleaned || "subscriber"}`;
}

export function buildCloudTaskPayload(options: {
  project: string;
  location: string;
  queue: string;
  target: string;
  subscriberId: string;
  dueAt: string;
  webhookSecret?: string;
}): { url: string; taskName: string; scheduleTime: string; targetUrl: string; bodyText: string } {
  const taskName = `projects/${options.project}/locations/${options.location}/queues/${options.queue}/tasks/${firstReplyTaskId(options.subscriberId)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.webhookSecret) headers["x-webhook-secret"] = options.webhookSecret;
  const bodyText = JSON.stringify({
    task: {
      name: taskName,
      scheduleTime: options.dueAt,
      httpRequest: {
        httpMethod: "POST",
        url: `${options.target}/tasks/first-reply`,
        headers,
        body: Buffer.from(JSON.stringify({ subscriberId: options.subscriberId }), "utf8").toString("base64"),
      },
    },
  });
  return {
    url: `https://cloudtasks.googleapis.com/v2/projects/${options.project}/locations/${options.location}/queues/${options.queue}/tasks`,
    taskName,
    scheduleTime: options.dueAt,
    targetUrl: `${options.target}/tasks/first-reply`,
    bodyText,
  };
}

export function cloudTaskCreateRequest(input: ScheduledReply): { url: string; body: string } {
  const project = config.cloudTasksProject;
  const location = config.cloudTasksLocation;
  const queue = config.cloudTasksQueue;
  const target = config.taskTargetUrl;
  if (!project || !location || !queue || !target) {
    throw new Error("Cloud Tasks is not configured.");
  }
  const payload = buildCloudTaskPayload({
    project,
    location,
    queue,
    target,
    subscriberId: input.subscriberId,
    dueAt: input.dueAt,
    webhookSecret: config.webhookSecret,
  });
  return { url: payload.url, body: payload.bodyText };
}

async function metadataAccessToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error(`Cloud Tasks auth failed (${response.status}).`);
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Cloud Tasks auth failed.");
  return payload.access_token;
}

export function createCloudTasksReplyScheduler(fetchToken: () => Promise<string> = metadataAccessToken): ReplyScheduler {
  return {
    async schedule(input) {
      const request = cloudTaskCreateRequest(input);
      const token = await fetchToken();
      const response = await fetch(request.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: request.body,
      });
      if (response.status === 409) {
        const payload = JSON.parse(request.body) as { task?: { name?: string } };
        return payload.task?.name ?? firstReplyTaskId(input.subscriberId);
      }
      if (!response.ok) throw new Error(`Cloud Tasks create failed (${response.status}).`);
      const created = (await response.json()) as { name?: string };
      return created.name ?? firstReplyTaskId(input.subscriberId);
    },
  };
}
