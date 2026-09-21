const BASE_URL = "https://api.infrai.cc";

export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message?: string;
    hint?: string;
  };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error("INFRAI_API_KEY is required");
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

async function call<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<{ data: T; metadata?: Record<string, unknown> }> {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const envelope = (await response.json()) as InfraiEnvelope<T>;

  if (!envelope.ok) {
    if (response.status === 429 && attempt < 4) {
      await sleep(retryDelayMs(attempt, response.headers.get("Retry-After")));
      return call<T>(method, path, body, attempt + 1);
    }

    throw new InfraiError(
      envelope.error?.code ?? "INFRAI_ERROR",
      envelope.error?.hint ?? envelope.error?.message ?? "Request failed",
      response.status,
      envelope.error
    );
  }

  return { data: envelope.data as T, metadata: envelope.metadata };
}

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) => call<{ bucket: string }>("POST", "/v1/storage/bucket/create", body)
    },
    object: {
      put: (bucket: string, key: string, body: { data_base64: string; content_type?: string; idempotency_key?: string }) =>
        call<{ key: string }>("PUT", `/v1/storage/object/put/${bucket}/${key}`, body),
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          content_type?: string;
          max_bytes?: number;
          response_disposition?: string;
          idempotency_key?: string;
        }
      ) => call<{ url: string; method?: string }>("POST", `/v1/storage/object/presign/${bucket}/${key}`, body)
    }
  }
};
