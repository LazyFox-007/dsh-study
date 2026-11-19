/**
 * 宿主工具的 schema 兜底。
 *
 * DSH 的 `defineTool` 参数用值 DSL（`required: true` 写在属性上）。
 * 解析不到 `@deepseek-ai/dsh-tools` 时必须自己转成合法 JSON Schema，
 * 否则模型会收到非法 schema 而报错——这里和学习平台那个插件用的是同一套约定。
 */
let realDefineTool = null;
try {
  ({ defineTool: realDefineTool } = await import('@deepseek-ai/dsh-tools'));
} catch {
  /* 拿不到就用下面的兜底 */
}

const SCALAR_KEYS = ['type', 'enum', 'const', 'description', 'title', 'default', 'examples'];
const pickScalar = (node) => Object.fromEntries(
  SCALAR_KEYS.filter((key) => node[key] !== undefined).map((key) => [key, node[key]]),
);

const dslNodeToJsonSchema = (node) => {
  if (!node || typeof node !== 'object') return {};
  if (node.type === 'json') return {};
  if (node.type === 'array') {
    return { ...pickScalar({ ...node, type: 'array' }), items: node.items ? dslNodeToJsonSchema(node.items) : undefined };
  }
  if (node.type === 'object') {
    const { schema, required } = dslPropertyMapToJsonSchema(node.properties ?? {});
    return {
      ...pickScalar({ ...node, type: 'object' }),
      properties: schema,
      ...(required.length ? { required } : {}),
      additionalProperties: node.additionalProperties !== false,
    };
  }
  return pickScalar(node);
};

const dslPropertyMapToJsonSchema = (spec) => {
  const properties = {};
  const required = [];
  for (const [key, node] of Object.entries(spec ?? {})) {
    if (!node || typeof node !== 'object') continue;
    const { required: isRequired, ...rest } = node;
    if (isRequired === true) required.push(key);
    properties[key] = dslNodeToJsonSchema(rest);
  }
  return { schema: properties, required };
};

const fallbackDefineTool = (spec) => {
  const { schema, required } = dslPropertyMapToJsonSchema(spec.parameters ?? {});
  return {
    ...spec,
    parameters: {
      type: 'object',
      properties: schema,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    output: spec.output ? { ...spec.output, schema: dslNodeToJsonSchema(spec.output.schema) } : spec.output,
  };
};

export const usingRealDefineTool = Boolean(realDefineTool);
export const defineTool = realDefineTool ?? fallbackDefineTool;
