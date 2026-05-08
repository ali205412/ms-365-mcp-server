import { z } from 'zod';
import { getPool } from '../postgres.js';
import type { PromptTemplateDefinition } from '../mcp-prompts/frontmatter.js';
import { SkillInputZod, SkillNameZod, type SkillInput, type SkillVisibility } from './schema.js';

const TenantIdZod = z.string().uuid();
const OwnerSubjectZod = z.string().trim().min(1).max(512).optional();

export interface TenantSkillRow {
  id: string;
  tenant_id: string;
  owner_subject: string | null;
  name: string;
  title: string;
  description: string;
  frontmatter: unknown;
  body: string;
  arguments: unknown;
  visibility: SkillVisibility;
  source: 'builtin' | 'fork' | 'custom' | 'import';
  source_skill_name: string | null;
  version: number;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface VisibleSkillWhereClause {
  readonly clause: string;
  readonly params: readonly unknown[];
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value === 'string') return z.array(z.unknown()).parse(JSON.parse(value));
  return z.array(z.unknown()).parse(value);
}

function rowToSkillInput(row: TenantSkillRow): SkillInput {
  return SkillInputZod.parse({
    name: row.name,
    title: row.title,
    description: row.description,
    frontmatter: typeof row.frontmatter === 'string' ? JSON.parse(row.frontmatter) : row.frontmatter,
    body: row.body,
    arguments: parseJsonArray(row.arguments),
    visibility: row.visibility,
    source: row.source,
    sourceSkillName: row.source_skill_name ?? undefined,
    version: row.version,
    enabled: row.enabled,
  });
}

export function visibleSkillWhereClause(
  tenantParamIndex: number,
  ownerSubject?: string
): VisibleSkillWhereClause {
  const owner = OwnerSubjectZod.parse(ownerSubject);
  if (!owner) {
    return {
      clause: `WHERE tenant_id = $${tenantParamIndex} AND enabled = true AND visibility IN ('tenant', 'admin', 'builtin-copy')`,
      params: [],
    };
  }
  return {
    clause: `WHERE tenant_id = $${tenantParamIndex} AND enabled = true AND (visibility IN ('tenant', 'admin', 'builtin-copy') OR (visibility = 'user' AND owner_subject = $${tenantParamIndex + 1}))`,
    params: [owner],
  };
}

export function skillRowToPrompt(row: TenantSkillRow): PromptTemplateDefinition {
  const skill = rowToSkillInput(row);
  return {
    sourcePath: `tenant-skills:${row.tenant_id}/${skill.name}`,
    name: skill.name,
    description: skill.description,
    arguments: skill.arguments,
    template: skill.body,
  };
}

export async function listVisibleSkills(
  tenantId: string,
  ownerSubject?: string
): Promise<PromptTemplateDefinition[]> {
  const tid = TenantIdZod.parse(tenantId);
  const visible = visibleSkillWhereClause(1, ownerSubject);
  const result = await getPool().query<TenantSkillRow>(
    `SELECT id, tenant_id, owner_subject, name, title, description, frontmatter, body,
            arguments, visibility, source, source_skill_name, version, enabled, created_at, updated_at
     FROM tenant_skills
     ${visible.clause}
     ORDER BY name ASC`,
    [tid, ...visible.params]
  );
  return result.rows.map(skillRowToPrompt);
}

export async function getVisibleSkill(
  tenantId: string,
  name: string,
  ownerSubject?: string
): Promise<PromptTemplateDefinition | null> {
  const tid = TenantIdZod.parse(tenantId);
  const parsedName = SkillNameZod.parse(name);
  const visible = visibleSkillWhereClause(1, ownerSubject);
  const result = await getPool().query<TenantSkillRow>(
    `SELECT id, tenant_id, owner_subject, name, title, description, frontmatter, body,
            arguments, visibility, source, source_skill_name, version, enabled, created_at, updated_at
     FROM tenant_skills
     ${visible.clause} AND name = $${2 + visible.params.length}
     LIMIT 1`,
    [tid, ...visible.params, parsedName]
  );
  return result.rows[0] ? skillRowToPrompt(result.rows[0]) : null;
}

export function forkBuiltinSkillInput(
  prompt: PromptTemplateDefinition,
  ownerSubject?: string
): SkillInput & { ownerSubject?: string } {
  return {
    name: prompt.name,
    title: prompt.name,
    description: prompt.description,
    frontmatter: {},
    body: prompt.template,
    arguments: [...prompt.arguments],
    visibility: ownerSubject ? 'user' : 'tenant',
    source: 'fork',
    sourceSkillName: prompt.name,
    version: 1,
    enabled: true,
    ...(ownerSubject ? { ownerSubject } : {}),
  };
}
