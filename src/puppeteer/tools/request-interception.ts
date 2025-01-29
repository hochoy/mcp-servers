import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Page, HTTPRequest, HTTPResponse } from "puppeteer";
import fs from "fs";
import path from "path";

function urlToSnakeCase(url: string): string {
  let result = url
    .replace(/^https?:\/\//, "") // Remove protocol
    .split("?")[0] // Remove query string
    .replace(/[^a-zA-Z0-9]/g, "_") // Replace non-alphanumeric characters with underscore
    .toLowerCase();

  // Truncate the result if it exceeds 229 bytes
  const maxBytes = 229;
  if (Buffer.byteLength(result) > maxBytes) {
    const ellipsis = "___";
    let truncated = result.slice(0, maxBytes - Buffer.byteLength(ellipsis));
    while (Buffer.byteLength(truncated + ellipsis) > maxBytes) {
      truncated = truncated.slice(0, -1);
    }
    result = truncated + ellipsis;
  }

  return result;
}

interface InterceptedRequestResponse {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    timestamp: number;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: string;
  };
}

// Store intercepted requests and responses
let interceptedRequests: Map<string, InterceptedRequestResponse> = new Map();

export const requestInterceptionTools = {
  enable: async (page: Page, jobFolder: string): Promise<CallToolResult> => {
    await page.setRequestInterception(true);
    interceptedRequests.clear(); // Clear previous requests
    return {
      content: [
        {
          type: "text",
          text: "Request interception enabled",
        },
      ],
      isError: false,
    };
  },

  disable: async (page: Page, jobFolder: string): Promise<CallToolResult> => {
    await page.setRequestInterception(false);
    // Save intercepted requests before clearing
    await saveInterceptedRequests(jobFolder);
    interceptedRequests.clear(); // Clear the intercepted requests
    return {
      content: [
        {
          type: "text",
          text: "Request interception disabled and requests saved",
        },
      ],
      isError: false,
    };
  },

  getInterceptedRequests: async (
    jobFolder: string
  ): Promise<CallToolResult> => {
    const requestsDir = path.join(jobFolder, "requests");
    let domainFolders: string[] = [];

    if (!fs.existsSync(requestsDir)) {
      await saveInterceptedRequests(jobFolder);
    }

    if (fs.existsSync(requestsDir)) {
      domainFolders = fs
        .readdirSync(requestsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
    }

    const fileListText = domainFolders
      .map((domain) => {
        const domainPath = path.join(requestsDir, domain);
        const files = fs
          .readdirSync(domainPath)
          .filter((file) => file.endsWith(".json"))
          .map((file) => `  ${file}`);
        return `- ${domain}/\n${files.join("\n")}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Intercepted requests have been saved to domain-specific folders in ${requestsDir}:\n\n${fileListText}`,
        },
      ],
      isError: false,
    };
  },

  // Function to handle request interception
  setupRequestInterception: (page: Page) => {
    page.on("request", (request: HTTPRequest) => {
      const requestData: InterceptedRequestResponse = {
        request: {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          postData: request.postData(),
          timestamp: Date.now(),
        },
      };
      interceptedRequests.set(request.url(), requestData);
      if (page && page.listenerCount("request") > 0) {
        request.continue().catch(console.error);
      }
    });

    page.on("response", async (response: HTTPResponse) => {
      const url = response.url();
      const requestData = interceptedRequests.get(url);
      if (requestData) {
        let responseBody;
        try {
          responseBody = await response.text();
        } catch (error) {
          console.error(`Failed to get response body for ${url}:`, error);
        }

        requestData.response = {
          status: response.status(),
          headers: response.headers(),
          body: responseBody,
        };
        interceptedRequests.set(url, requestData);
      }
    });
  },

  getRequestDetails: async (
    jobFolder: string,
    url: string
  ): Promise<CallToolResult> => {
    const requestsDir = path.join(jobFolder, "requests");
    const domain = extractDomain(url);
    const domainFolderName = domain.replace(/[^a-zA-Z0-9-]/g, "_");
    const domainFolderPath = path.join(requestsDir, domainFolderName);
    let requestData: InterceptedRequestResponse | undefined;

    if (fs.existsSync(domainFolderPath)) {
      const files = fs.readdirSync(domainFolderPath);
      const urlSnakeCase = urlToSnakeCase(url);
      const matchingFile = files.find((file) =>
        file.endsWith(`_${urlSnakeCase}.json`)
      );

      if (matchingFile) {
        const filePath = path.join(domainFolderPath, matchingFile);
        requestData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    }

    if (!requestData) {
      // If not found in domain-specific folder, check the in-memory map
      requestData = interceptedRequests.get(url);
    }

    if (!requestData) {
      return {
        content: [
          {
            type: "text",
            text: `No request found for URL: ${url}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(requestData, null, 2),
        },
      ],
      isError: false,
    };
  },
};

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    console.error(`Failed to extract domain from ${url}:`, error);
    return "unknown-domain";
  }
}

function groupRequestsByDomain(
  requests: InterceptedRequestResponse[]
): Map<string, InterceptedRequestResponse[]> {
  const groupedRequests = new Map<string, InterceptedRequestResponse[]>();

  for (const request of requests) {
    const domain = extractDomain(request.request.url);
    if (!groupedRequests.has(domain)) {
      groupedRequests.set(domain, []);
    }
    groupedRequests.get(domain)!.push(request);
  }

  return groupedRequests;
}

async function saveInterceptedRequests(jobFolder: string): Promise<void> {
  const requestsData = Array.from(interceptedRequests.values());
  const groupedRequests = groupRequestsByDomain(requestsData);

  // Create a requests directory if it doesn't exist
  const requestsDir = path.join(jobFolder, "requests");
  if (!fs.existsSync(requestsDir)) {
    fs.mkdirSync(requestsDir, { recursive: true });
  }

  // Save individual domain folders and files
  for (const [domain, requests] of groupedRequests.entries()) {
    const domainFolderName = domain.replace(/[^a-zA-Z0-9-]/g, "_");
    const domainFolderPath = path.join(requestsDir, domainFolderName);
    if (!fs.existsSync(domainFolderPath)) {
      fs.mkdirSync(domainFolderPath, { recursive: true });
    }

    for (const request of requests) {
      const timestamp = request.request.timestamp.toString();
      const urlSnakeCase = urlToSnakeCase(request.request.url);
      const fileName = `${timestamp}_${urlSnakeCase}.json`;
      const filePath = path.join(domainFolderPath, fileName);
      fs.writeFileSync(filePath, JSON.stringify(request, null, 2));
    }
  }
}
