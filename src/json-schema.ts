import { z } from "zod";

// Convert Zod schema to JSON Schema
export function zodToJsonSchema(schema: z.ZodType): object {
  const jsonSchema = zodTypeToJsonSchema(schema);

  // The MCP tool contract requires an object schema at the top level
  if (jsonSchema.type !== "object") {
    return { type: "object", properties: {} };
  }

  return jsonSchema;
}

function zodTypeToJsonSchema(zodType: z.ZodType): Record<string, any> {
  const schema = buildJsonSchema(zodType);

  // A description can sit on any wrapper level (e.g. z.string().optional().describe()),
  // so keep the outermost one we encounter on the way down.
  if (zodType.description && !schema.description) {
    schema.description = zodType.description;
  }

  return schema;
}

function buildJsonSchema(zodType: z.ZodType): Record<string, any> {
  // Unwrap the wrappers that do not change the JSON Schema shape
  if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
    return zodTypeToJsonSchema(zodType._def.innerType);
  }

  if (zodType instanceof z.ZodEffects) {
    return zodTypeToJsonSchema(zodType._def.schema);
  }

  if (zodType instanceof z.ZodDefault) {
    return {
      ...zodTypeToJsonSchema(zodType._def.innerType),
      default: zodType._def.defaultValue(),
    };
  }

  // Handle nested objects
  if (zodType instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(zodType.shape as Record<string, z.ZodType>)) {
      properties[key] = zodTypeToJsonSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }

    const schema: Record<string, any> = { type: "object", properties };
    if (required.length > 0) {
      schema.required = required;
    }
    return schema;
  }

  // Handle array
  if (zodType instanceof z.ZodArray) {
    return { type: "array", items: zodTypeToJsonSchema(zodType._def.type) };
  }

  // Handle enum
  if (zodType instanceof z.ZodEnum) {
    return { type: "string", enum: zodType._def.values };
  }

  // Handle literal
  if (zodType instanceof z.ZodLiteral) {
    return { type: typeof zodType._def.value, const: zodType._def.value };
  }

  // Handle primitives
  if (zodType instanceof z.ZodString) {
    return { type: "string" };
  }

  if (zodType instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (zodType instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  // Unknown type: stay permissive rather than claiming it is a string
  return {};
}

