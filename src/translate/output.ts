import { Writable } from "node:stream";
import { translate } from "./locale.js";

export function translatingWritable(inner: Writable): Writable {
  const outer = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  outer.write = ((chunk: unknown, cb?: (err?: Error | null) => void) => {
    const text = typeof chunk === "string" ? chunk : String(chunk);
    return inner.write(translate(text), cb);
  }) as typeof outer.write;
  (outer as { isTTY?: boolean }).isTTY = (inner as { isTTY?: boolean }).isTTY;
  return outer;
}
