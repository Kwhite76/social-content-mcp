// Copyright 2026 Kwhite76
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Talks to Penpot's hosted MCP server with the user's own MCP key, so the user only
 * installs this one extension. Penpot runs the work through its plugin in an open
 * Penpot tab (kept connected by the keeper).
 *   endpoint: <penpot url>/mcp/stream?userToken=<MCP key>
 */
export class PenpotBridge {
  private client?: Client;

  constructor(private url: string, private key?: string) {}

  get configured() {
    return !!this.key;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.key) throw new Error("No Penpot MCP key set. Add it in the extension settings (Penpot: Your account > Integrations > MCP Server).");
    const endpoint = new URL(`${this.url}/mcp/stream`);
    endpoint.searchParams.set("userToken", this.key);
    const client = new Client({ name: "social-content-mcp", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    this.client = client;
    return client;
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = undefined;
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.connect();
    try {
      return (await client.callTool({ name, arguments: args }, undefined, { timeout: 150_000 })) as CallToolResult;
    } catch {
      // one reconnect for a dropped session
      await this.close();
      const again = await this.connect();
      return (await again.callTool({ name, arguments: args }, undefined, { timeout: 150_000 })) as CallToolResult;
    }
  }

  async tools(): Promise<string[]> {
    const client = await this.connect();
    return (await client.listTools()).tools.map((t) => t.name);
  }

  /** Runs JavaScript in the Penpot plugin. Returns the text the tool returned. */
  async execute(code: string): Promise<string> {
    const res = await this.call("execute_code", { code });
    const text = textOf(res);
    // Penpot reports some failures (e.g. a suspended plugin tab) as plain text, not isError
    if (res.isError || /^Tool execution failed/i.test(text)) throw new Error(text || "Penpot execute_code failed");
    return text;
  }

  /** Exports a shape (board) to PNG and writes it to outPath. */
  async exportPng(shapeId: string, outPath: string, mode: "shape" | "fill" = "shape"): Promise<{ path: string; width: number; height: number }> {
    const res = await this.call("export_shape", { shapeId, format: "png", mode });
    if (res.isError) throw new Error(textOf(res) || "Penpot export_shape failed");
    const img = (res.content as Array<{ type: string; data?: string }>).find((c) => c.type === "image" && c.data);
    if (!img?.data) throw new Error("Penpot returned no image for that shape");
    const buf = Buffer.from(img.data, "base64");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return { path: outPath, ...pngSize(buf) };
  }
}

function textOf(res: { content?: unknown }): string {
  const parts = (res.content as Array<{ type: string; text?: string }> | undefined) ?? [];
  return parts.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
}

/** Width and height from a PNG header. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
