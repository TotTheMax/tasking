import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MockResponse {
  status: number;
  body: unknown;
  delayMs?: number;
}

export type MockHandler = (req: MockRequest) => MockResponse;

export interface MockServer {
  port: number;
  baseUrl: string;
  requests: MockRequest[];
  close: () => Promise<void>;
}

export async function createMockJiraServer(handler: MockHandler): Promise<MockServer> {
  const requests: MockRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.on("error", () => {});
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      let parsedBody: unknown = rawBody;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          // keep raw string for non-JSON bodies
        }
      }
      const mockReq: MockRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: { ...req.headers },
        body: parsedBody,
      };
      requests.push(mockReq);
      try {
        const mockRes = handler(mockReq);
        const send = () => {
          if (res.writableEnded) return;
          res.writeHead(mockRes.status, { "Content-Type": "application/json" });
          if (typeof mockRes.body === "string") {
            res.end(mockRes.body);
          } else {
            res.end(JSON.stringify(mockRes.body));
          }
        };
        if (mockRes.delayMs) {
          setTimeout(send, mockRes.delayMs);
        } else {
          send();
        }
      } catch (e) {
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}
