import { z } from "zod";
import { toUnixTimestamp } from "../lib/dates.js";
import { unwrap } from "../lib/errors.js";
import { payload } from "../lib/format.js";
import { defineTool } from "../lib/tool.js";

export const exportTools = {
  start_datev_export: defineTool({
    title: "Start DATEV export",
    description:
      "Start a DATEV CSV export (ZIP) for a period and return the export job ID. The export runs asynchronously: poll get_export_job_download_info with the job ID until it returns a download link. " +
      "Requires the accounting year begin to be set in sevdesk. The documents are NOT enshrined by this tool.",
    access: "write",
    inputSchema: z.object({
      startDate: z.string().describe("Start of the period: YYYY-MM-DD, DD.MM.YYYY or Unix timestamp"),
      endDate: z.string().describe("End of the period (inclusive)"),
      scope: z
        .string()
        .regex(/^[EXTCD]{1,5}$/, "Use the letters E, X, T, C, D")
        .default("EXTCD")
        .describe("What to include: E=Earnings (revenue), X=Expenditure, T=Transactions, C=Cashregister, D=Assets. Default EXTCD (everything)."),
      exportByPaydate: z.boolean().default(false).describe("true = only paid documents whose pay date lies in the period"),
      includeEnshrined: z.boolean().default(true).describe("false = exclude already enshrined documents"),
      includeDocumentImages: z.boolean().default(false).describe("Include the document images (larger export)"),
    }),
    handler: async (client, params) => {
      const jobId = payload(
        unwrap(
          await client.GET("/Export/createDatevCsvZipExportJob", {
            params: {
              query: {
                startDate: toUnixTimestamp(params.startDate),
                endDate: toUnixTimestamp(params.endDate, { endOfDay: true }),
                scope: params.scope,
                exportByPaydate: params.exportByPaydate,
                includeEnshrined: params.includeEnshrined,
                includeDocumentImages: params.includeDocumentImages,
                enshrineDocuments: false,
              } as never,
            },
          })
        )
      );
      return { jobId, next: "Call get_export_job_download_info with this jobId until a download link is returned." };
    },
  }),

  get_export_job_download_info: defineTool({
    title: "Get export download link",
    description:
      "Get the download link of an export job started with start_datev_export. If the export is not finished yet, the link is missing - try again in a few seconds. The link is a pre-signed URL that expires after about 7 days.",
    access: "read",
    inputSchema: z.object({ jobId: z.string().describe("The export job ID returned by start_datev_export") }),
    handler: async (client, params) =>
      payload(unwrap(await client.GET("/ExportJob/jobDownloadInfo", { params: { query: { jobId: params.jobId } } }))),
  }),
};
