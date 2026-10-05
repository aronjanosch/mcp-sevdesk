import { z } from "zod";
import { payload } from "../lib/format.js";
import { fetchPage, paginationShape } from "../lib/pagination.js";
import { defineTool } from "../lib/tool.js";
import { unwrap } from "../lib/errors.js";

const contactCategory = (id: number) => ({ id, objectName: "Category" as const });

export const contactTools = {
  list_contacts: defineTool({
    title: "List contacts",
    description: "List contacts (customers, suppliers, partners) from sevdesk. Returns one page; use nextOffset to continue.",
    access: "read",
    inputSchema: z.object({
      customerNumber: z.string().optional().describe("Filter by customer number"),
      name: z.string().optional().describe("Filter by contact name"),
      depth: z.union([z.literal(0), z.literal(1)]).optional().describe("0 = contacts only, 1 = include sub-objects such as the category"),
      ...paginationShape,
    }),
    handler: (client, params) =>
      fetchPage(params, async (limit, offset) =>
        unwrap(
          await client.GET("/Contact", {
            params: {
              query: {
                customerNumber: params.customerNumber,
                name: params.name,
                depth: params.depth === undefined ? undefined : (String(params.depth) as "0" | "1"),
                limit,
                offset,
              },
            },
          })
        )
      ),
  }),

  get_contact: defineTool({
    title: "Get contact",
    description: "Get a specific contact by ID from sevdesk",
    access: "read",
    inputSchema: z.object({
      contactId: z.number().int().describe("The ID of the contact to retrieve"),
    }),
    handler: async (client, params) =>
      payload(await unwrap(await client.GET("/Contact/{contactId}", { params: { path: { contactId: params.contactId } } }))),
  }),

  get_next_customer_number: defineTool({
    title: "Get next customer number",
    description: "Get the next free customer number. Use it as customerNumber when creating a contact.",
    access: "read",
    inputSchema: z.object({}),
    handler: async (client) => unwrap(await client.GET("/Contact/Factory/getNextCustomerNumber", {})),
  }),

  create_contact: defineTool({
    title: "Create contact",
    description: "Create a new contact in sevdesk. Use name for organizations, surename + familyname for persons.",
    access: "write",
    inputSchema: z.object({
      name: z.string().optional().describe("The name of the contact (for organizations)"),
      surename: z.string().optional().describe("The first name of the contact person"),
      familyname: z.string().optional().describe("The family name of the contact person"),
      customerNumber: z.string().optional().describe("Customer number, see get_next_customer_number"),
      description: z.string().optional().describe("Description of the contact"),
      categoryId: z.number().int().describe("Category ID (3 = customer, 4 = supplier, 28 = partner)"),
    }),
    handler: async (client, params) => {
      const { categoryId, ...fields } = params;
      return payload(
        unwrap(
          await client.POST("/Contact", {
            body: { ...fields, category: contactCategory(categoryId) } as never,
          })
        )
      );
    },
  }),

  update_contact: defineTool({
    title: "Update contact",
    description: "Update an existing contact in sevdesk. Only the given fields are changed.",
    access: "write",
    idempotent: true,
    inputSchema: z.object({
      contactId: z.number().int().describe("The ID of the contact to update"),
      name: z.string().optional().describe("The name of the contact"),
      surename: z.string().optional().describe("The first name"),
      familyname: z.string().optional().describe("The family name"),
      customerNumber: z.string().optional().describe("Customer number"),
      description: z.string().optional().describe("Description"),
    }),
    handler: async (client, { contactId, ...fields }) =>
      payload(unwrap(await client.PUT("/Contact/{contactId}", { params: { path: { contactId } }, body: fields as never }))),
  }),

  delete_contact: defineTool({
    title: "Delete contact",
    description: "Delete a contact from sevdesk. Fails if documents still reference the contact. Cannot be undone.",
    access: "destructive",
    idempotent: true,
    inputSchema: z.object({
      contactId: z.number().int().describe("The ID of the contact to delete"),
    }),
    handler: async (client, params) => {
      unwrap(await client.DELETE("/Contact/{contactId}", { params: { path: { contactId: params.contactId } } }));
      return { success: true, deletedContactId: params.contactId };
    },
  }),
};

