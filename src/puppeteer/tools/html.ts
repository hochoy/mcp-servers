import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Page } from "puppeteer";
import fs from "fs";
import path from "path";

export const htmlTools = {
  getHtml: async (page: Page, jobFolder: string): Promise<CallToolResult> => {
    try {
      const html = await page.content();

      // Save HTML to job folder
      const htmlPath = path.join(jobFolder, "index.html");
      fs.writeFileSync(htmlPath, html);

      return {
        content: [
          {
            type: "text",
            text: `HTML content saved to ${htmlPath}\n\n`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get HTML content: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
