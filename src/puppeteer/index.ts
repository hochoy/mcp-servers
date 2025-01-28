#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { requestInterceptionTools } from "./tools/request-interception.js";
import { htmlTools } from "./tools/html.js";
// Tool definitions

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: "puppeteer_get_html",
    description: "Get the entire HTML content of the current page",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "puppeteer_enable_request_interception",
    description: "Enable request interception",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "puppeteer_disable_request_interception",
    description: "Disable request interception",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "puppeteer_get_intercepted_requests",
    description: "Get the list of intercepted requests",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "puppeteer_get_request_details",
    description:
      "Get detailed information about a specific request/response pair",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL of the request to retrieve details for",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["url", "jobId"],
    },
  },
  {
    name: "puppeteer_create_job",
    description: "Create a new job with a unique identifier",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to click",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["selector", "jobId"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for input field",
        },
        value: {
          type: "string",
          description: "Value to fill",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["selector", "value", "jobId"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an element on the page with Select tag",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to select",
        },
        value: {
          type: "string",
          description: "Value to select",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["selector", "value", "jobId"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to hover",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["selector", "jobId"],
    },
  },
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["url", "jobId"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the screenshot",
        },
        selector: {
          type: "string",
          description: "CSS selector for element to screenshot",
        },
        width: {
          type: "number",
          description: "Width in pixels (default: 800)",
        },
        height: {
          type: "number",
          description: "Height in pixels (default: 600)",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["name", "jobId"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript code to execute",
        },
        jobId: {
          type: "string",
          description: "Job identifier",
        },
      },
      required: ["script", "jobId"],
    },
  },
];

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
const consoleLogs: string[] = [];
const screenshots = new Map<string, string>();
const jobFolders = new Map<string, string>();

// Job folder management
function getJobFolder(jobId: string): string {
  const existingFolder = jobFolders.get(jobId);
  if (existingFolder) {
    return existingFolder;
  }

  const tmpDir = path.join(path.dirname(__dirname), "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }

  // Check for existing folder with jobId prefix
  const existingFolders = fs.readdirSync(tmpDir);
  const existingJobFolder = existingFolders.find((folder) =>
    folder.startsWith(`${jobId}-`)
  );
  if (existingJobFolder) {
    const fullPath = path.join(tmpDir, existingJobFolder);
    jobFolders.set(jobId, fullPath);
    return fullPath;
  }

  // Create new folder with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `${jobId}-${timestamp}`;
  const folderPath = path.join(tmpDir, folderName);
  fs.mkdirSync(folderPath);
  jobFolders.set(jobId, folderPath);
  return folderPath;
}

async function ensureBrowser() {
  if (!browser) {
    const npx_args = { headless: false };
    const docker_args = {
      headless: true,
      args: ["--no-sandbox", "--single-process", "--no-zygote"],
    };
    browser = await puppeteer.launch(
      process.env.DOCKER_CONTAINER ? docker_args : npx_args
    );
    const pages = await browser.pages();
    page = pages[0];

    page.on("console", (msg) => {
      const logEntry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(logEntry);
      server.notification({
        method: "notifications/resources/updated",
        params: { uri: "console://logs" },
      });
    });

    // Setup request interception
    requestInterceptionTools.setupRequestInterception(page);

    browser.on("disconnected", () => {
      console.error("Browser disconnected");
      browser = undefined;
      page = undefined;
    });
  }
  return page!;
}

declare global {
  interface Window {
    mcpHelper: {
      logs: string[];
      originalConsole: Partial<typeof console>;
    };
  }
}

async function handleToolCall(
  name: string,
  args: any
): Promise<CallToolResult> {
  try {
    const page = await ensureBrowser();

    // Handle job creation separately as it doesn't require a jobId
    if (name === "puppeteer_create_job") {
      const jobId = `job-${Date.now()}`;
      const jobFolder = getJobFolder(jobId);
      return {
        content: [
          {
            type: "text",
            text: `Created job ${jobId} with folder ${jobFolder}`,
          },
        ],
        isError: false,
      };
    }

    // For all other tools, ensure jobId is provided
    if (!args.jobId) {
      return {
        content: [
          {
            type: "text",
            text: "jobId is required",
          },
        ],
        isError: true,
      };
    }

    // Get or create job folder
    const jobFolder = getJobFolder(args.jobId);

    switch (name) {
      case "puppeteer_enable_request_interception":
        return await requestInterceptionTools.enable(page, jobFolder);

      case "puppeteer_disable_request_interception":
        return await requestInterceptionTools.disable(page, jobFolder);

      case "puppeteer_get_intercepted_requests":
        return await requestInterceptionTools.getInterceptedRequests(jobFolder);

      case "puppeteer_get_request_details":
        return await requestInterceptionTools.getRequestDetails(
          jobFolder,
          args.url
        );

      case "puppeteer_get_html":
        return await htmlTools.getHtml(page, jobFolder);

      case "puppeteer_navigate":
        await page.goto(args.url);
        return {
          content: [
            {
              type: "text",
              text: `Navigated to ${args.url}`,
            },
          ],
          isError: false,
        };

      case "puppeteer_screenshot": {
        const width = args.width ?? 800;
        const height = args.height ?? 600;
        await page.setViewport({ width, height });

        const screenshot = await (args.selector
          ? (await page.$(args.selector))?.screenshot({ encoding: "base64" })
          : page.screenshot({ encoding: "base64", fullPage: false }));

        if (!screenshot) {
          return {
            content: [
              {
                type: "text",
                text: args.selector
                  ? `Element not found: ${args.selector}`
                  : "Screenshot failed",
              },
            ],
            isError: true,
          };
        }

        // Save screenshot to job folder
        const screenshotPath = path.join(jobFolder, `${args.name}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot, "base64"));

        screenshots.set(args.name, screenshot as string);
        server.notification({
          method: "notifications/resources/list_changed",
        });

        return {
          content: [
            {
              type: "text",
              text: `Screenshot '${args.name}' taken at ${width}x${height} and saved to ${screenshotPath}`,
            } as TextContent,
            {
              type: "image",
              data: screenshot,
              mimeType: "image/png",
            } as ImageContent,
          ],
          isError: false,
        };
      }

      case "puppeteer_click":
        try {
          await page.click(args.selector);
          return {
            content: [
              {
                type: "text",
                text: `Clicked: ${args.selector}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to click ${args.selector}: ${
                  (error as Error).message
                }`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_fill":
        try {
          await page.waitForSelector(args.selector);
          await page.type(args.selector, args.value);
          return {
            content: [
              {
                type: "text",
                text: `Filled ${args.selector} with: ${args.value}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fill ${args.selector}: ${
                  (error as Error).message
                }`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_select":
        try {
          await page.waitForSelector(args.selector);
          await page.select(args.selector, args.value);
          return {
            content: [
              {
                type: "text",
                text: `Selected ${args.selector} with: ${args.value}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to select ${args.selector}: ${
                  (error as Error).message
                }`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_hover":
        try {
          await page.waitForSelector(args.selector);
          await page.hover(args.selector);
          return {
            content: [
              {
                type: "text",
                text: `Hovered ${args.selector}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to hover ${args.selector}: ${
                  (error as Error).message
                }`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_evaluate":
        try {
          await page.evaluate(() => {
            window.mcpHelper = {
              logs: [],
              originalConsole: { ...console },
            };

            ["log", "info", "warn", "error"].forEach((method) => {
              (console as any)[method] = (...args: any[]) => {
                window.mcpHelper.logs.push(`[${method}] ${args.join(" ")}`);
                (window.mcpHelper.originalConsole as any)[method](...args);
              };
            });
          });

          const result = await page.evaluate(args.script);

          const logs = await page.evaluate(() => {
            Object.assign(console, window.mcpHelper.originalConsole);
            const logs = window.mcpHelper.logs;
            delete (window as any).mcpHelper;
            return logs;
          });

          return {
            content: [
              {
                type: "text",
                text: `Execution result:\n${JSON.stringify(
                  result,
                  null,
                  2
                )}\n\nConsole output:\n${logs.join("\n")}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Script execution failed: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    console.error(`Error in handleToolCall: ${error}`);
    return {
      content: [
        {
          type: "text",
          text: `An error occurred: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

const server = new Server(
  {
    name: "example-servers/puppeteer",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Setup request handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "console://logs",
      mimeType: "text/plain",
      name: "Browser console logs",
    },
    ...Array.from(screenshots.keys()).map((name) => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();

  if (uri === "console://logs") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: consoleLogs.join("\n"),
        },
      ],
    };
  }

  if (uri.startsWith("screenshot://")) {
    const name = uri.split("://")[1];
    const screenshot = screenshots.get(name);
    if (screenshot) {
      return {
        contents: [
          {
            uri,
            mimeType: "image/png",
            blob: screenshot,
          },
        ],
      };
    }
  }

  throw new Error(`Resource not found: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);

process.stdin.on("close", async () => {
  console.error("Puppeteer MCP Server closed");
  if (browser) {
    await browser.close().catch(console.error);
  }
  await server.close().catch(console.error);
});

process.on("SIGINT", async () => {
  console.error("Received SIGINT. Closing server and browser.");
  if (browser) {
    await browser.close().catch(console.error);
  }
  await server.close().catch(console.error);
  process.exit(0);
});
