/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// --- Constants & Policies ---

const OWNER_USERNAME = process.env.USERNAME;

// Supported actions
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
  'updateUserAdultFilter',
] as const;

// Actions that a user can perform on themselves
const SELF_ALLOWED_ACTIONS = [
  'changePassword',
  'updateUserApis',
  'updateUserGroups',
  'updateUserAdultFilter',
];

// --- Helpers ---

// Safe Type Coercion & Sanitization
const asTrimmedString = (v: any): string =>
  typeof v === 'string' ? v.trim() : '';

const asStringArray = (v: any): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter((x) => x.length > 0)
    : [];

const asBoolean = (v: any): boolean =>
  v === true || v === 'true' || v === 1 || v === '1';

// Validate Source Keys
const validateSourceKeys = (keys: string[], config: any): string[] => {
  if (keys.length === 0) return [];
  const validKeys = new Set((config.SourceConfig || []).map((s: any) => s.key));
  return keys.filter((k) => validKeys.has(k));
};

// Validate Group Tags
const validateGroupTags = (tags: string[], config: any): string[] => {
  if (tags.length === 0) return [];
  const validTags = new Set(
    (config.UserConfig.Tags || []).map((t: any) => t.name),
  );
  return tags.filter((t) => validTags.has(t));
};

// Check if a user object is privileged (Admin or Env-Owner)
const isPrivilegedUser = (u: any): boolean => {
  if (!u) return false;
  return (
    u.role === 'admin' || (!!OWNER_USERNAME && u.username === OWNER_USERNAME)
  );
};

// --- Main Handler ---

export async function GET(request: NextRequest) {
  try {
    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminConfig = await getConfig();

    // Determine operator role
    let operatorRole = 'user';
    if (OWNER_USERNAME && authInfo.username === OWNER_USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (userEntry && !userEntry.banned) {
        operatorRole = userEntry.role;
      }
    }

    if (operatorRole !== 'owner' && operatorRole !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    // Return sensitive user data only to admins
    return NextResponse.json(adminConfig.UserConfig.Users, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('List users failed:', error);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();

    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 1. Sanitize Inputs
    const action = rawBody.action;
    const targetUsername = asTrimmedString(rawBody.targetUsername);
    const targetPassword = asTrimmedString(rawBody.targetPassword);

    // Payload extractions
    const userGroup = asTrimmedString(rawBody.userGroup);
    const groupAction = asTrimmedString(rawBody.groupAction);
    const groupName = asTrimmedString(rawBody.groupName);
    const enabledApis = asStringArray(rawBody.enabledApis);
    const userGroups = asStringArray(rawBody.userGroups);
    const usernames = asStringArray(rawBody.usernames);
    const disableYellowFilter = asBoolean(rawBody.disableYellowFilter);

    // 2. Basic Validation
    if (!action || !ACTIONS.includes(action as any)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    if (
      !targetUsername &&
      !['userGroup', 'batchUpdateUserGroups'].includes(action)
    ) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    // 3. Self-Action Guard
    if (
      username === targetUsername &&
      !SELF_ALLOWED_ACTIONS.includes(action) &&
      action !== 'deleteUser' // Handled specifically in deleteUser logic
    ) {
      return NextResponse.json(
        { error: '无法对自己进行此操作' },
        { status: 400 },
      );
    }

    // 4. Load Config & Resolve Operator Role
    const adminConfig = await getConfig();

    let operatorRole: 'owner' | 'admin' | 'user';

    // Strict Owner Check (Env Source of Truth)
    if (OWNER_USERNAME && username === OWNER_USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username,
      );
      // Ignore config 'owner' role. Only ENV determines owner.
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 403 });
      }
      operatorRole = userEntry.role;
    }

    // 5. Resolve Target
    let targetEntry: any = null;
    let isTargetPrivileged = false; // "Privileged" = Admin or Real Owner
    const isTargetOwner = !!OWNER_USERNAME && targetUsername === OWNER_USERNAME;

    if (targetUsername) {
      targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername,
      );

      // Global Owner Protection (Immediate 403, even if Owner is not in config)
      if (isTargetOwner && operatorRole !== 'owner') {
        return NextResponse.json({ error: '无法操作站长' }, { status: 403 });
      }

      // Check if target is privileged (Admin or Env-Owner)
      if (isTargetOwner || (targetEntry && isPrivilegedUser(targetEntry))) {
        isTargetPrivileged = true;
      }
    }

    let didSaveConfig = false;

    // --- Action Logic ---

    switch (action) {
      case 'add': {
        if (operatorRole !== 'owner' && operatorRole !== 'admin') {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }

        // CRITICAL FIX: Prevent hijacking Owner account
        if (isTargetOwner) {
          return NextResponse.json(
            { error: '禁止创建站长同名账户' },
            { status: 403 },
          );
        }

        if (targetEntry)
          return NextResponse.json({ error: '用户已存在' }, { status: 400 });
        if (!targetPassword || targetPassword.length < 8) {
          return NextResponse.json(
            { error: '密码过短 (至少8位) 或缺失' },
            { status: 400 },
          );
        }

        // 1. Auth DB Write
        await db.registerUser(targetUsername, targetPassword);

        // 2. Config Update
        const newUser: any = { username: targetUsername, role: 'user' };

        if (userGroup) {
          const validTags = validateGroupTags([userGroup], adminConfig);
          if (validTags.length > 0) newUser.tags = validTags;
        }

        try {
          adminConfig.UserConfig.Users.push(newUser);
          await db.saveAdminConfig(adminConfig);
          didSaveConfig = true;
        } catch (e) {
          // Compensating Transaction
          console.error('Config save failed, rolling back Auth DB', e);
          try {
            await db.deleteUser(targetUsername);
          } catch (delError) {
            console.error('Rollback delete failed', delError);
          }
          throw e;
        }
        break;
      }

      case 'deleteUser': {
        // Safety: Check Owner Protection FIRST (before 404)
        if (isTargetOwner)
          return NextResponse.json(
            { error: '无法删除站长账户' },
            { status: 403 },
          );

        if (!targetEntry)
          return NextResponse.json(
            { error: '目标用户不存在' },
            { status: 404 },
          );
        if (username === targetUsername)
          return NextResponse.json({ error: '不能删除自己' }, { status: 400 });

        if (isTargetPrivileged && operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '仅站长可删除管理员' },
            { status: 403 },
          );
        }

        const idx = adminConfig.UserConfig.Users.findIndex(
          (u) => u.username === targetUsername,
        );
        if (idx > -1) adminConfig.UserConfig.Users.splice(idx, 1);

        await db.saveAdminConfig(adminConfig);
        didSaveConfig = true;

        try {
          await db.deleteUser(targetUsername);
        } catch (e) {
          console.error('Auth delete failed after config update', e);
        }
        break;
      }

      case 'changePassword': {
        // Safety: Check Owner Protection FIRST
        if (
          isTargetOwner &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }

        // Pure Auth DB action
        if (!targetEntry && !isTargetOwner) {
          // Optional: Allow password reset for Owner even if not in config?
          // For strict safety, we usually require targetEntry or allow Owner override.
          // Here we keep strict requirement unless it's the Owner operating on themselves.
          if (operatorRole !== 'owner')
            return NextResponse.json({ error: '用户不存在' }, { status: 404 });
        }

        if (!targetPassword || targetPassword.length < 8) {
          return NextResponse.json(
            { error: '新密码过短 (至少8位)' },
            { status: 400 },
          );
        }

        if (
          isTargetPrivileged &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }

        await db.changePassword(targetUsername, targetPassword);
        return NextResponse.json(
          { ok: true },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'ban':
      case 'unban': {
        if (isTargetOwner)
          return NextResponse.json({ error: '无法封禁站长' }, { status: 403 });
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });

        if (isTargetPrivileged && operatorRole !== 'owner')
          return NextResponse.json({ error: '权限不足' }, { status: 403 });

        targetEntry.banned = action === 'ban';
        break;
      }

      case 'setAdmin': {
        if (isTargetOwner)
          return NextResponse.json(
            { error: '无法修改站长角色' },
            { status: 403 },
          );
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });

        if (operatorRole !== 'owner')
          return NextResponse.json({ error: '仅站长可操作' }, { status: 403 });
        if (targetEntry.banned)
          return NextResponse.json(
            { error: '无法提升被封禁用户' },
            { status: 400 },
          );
        if (targetEntry.role === 'admin')
          return NextResponse.json(
            { error: '该用户已是管理员' },
            { status: 400 },
          );

        targetEntry.role = 'admin';
        break;
      }

      case 'cancelAdmin': {
        if (isTargetOwner)
          return NextResponse.json(
            { error: '无法修改站长角色' },
            { status: 403 },
          );
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });

        if (operatorRole !== 'owner')
          return NextResponse.json({ error: '仅站长可操作' }, { status: 403 });
        if (targetEntry.role !== 'admin')
          return NextResponse.json(
            { error: '目标不是管理员' },
            { status: 400 },
          );

        targetEntry.role = 'user';
        break;
      }

      case 'updateUserApis': {
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });
        if (
          isTargetPrivileged &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }

        const safeApis = validateSourceKeys(enabledApis, adminConfig);
        if (safeApis.length > 0) targetEntry.enabledApis = safeApis;
        else delete targetEntry.enabledApis;
        break;
      }

      case 'userGroup': {
        if (operatorRole !== 'owner')
          return NextResponse.json(
            { error: '仅站长可管理用户组' },
            { status: 403 },
          );

        if (!['add', 'edit', 'delete'].includes(groupAction)) {
          return NextResponse.json({ error: '无效操作' }, { status: 400 });
        }
        if (!groupName)
          return NextResponse.json({ error: '缺少组名' }, { status: 400 });

        if (!adminConfig.UserConfig.Tags) adminConfig.UserConfig.Tags = [];
        const tags = adminConfig.UserConfig.Tags;

        if (groupAction === 'add') {
          if (tags.find((t) => t.name === groupName))
            return NextResponse.json(
              { error: '用户组已存在' },
              { status: 400 },
            );
          tags.push({
            name: groupName,
            enabledApis: validateSourceKeys(enabledApis, adminConfig),
          });
        } else if (groupAction === 'edit') {
          const t = tags.find((t) => t.name === groupName);
          if (!t)
            return NextResponse.json(
              { error: '用户组不存在' },
              { status: 404 },
            );
          t.enabledApis = validateSourceKeys(enabledApis, adminConfig);
        } else if (groupAction === 'delete') {
          const idx = tags.findIndex((t) => t.name === groupName);
          if (idx === -1)
            return NextResponse.json(
              { error: '用户组不存在' },
              { status: 404 },
            );

          adminConfig.UserConfig.Users.forEach((u) => {
            if (u.tags?.includes(groupName)) {
              u.tags = u.tags.filter((t: string) => t !== groupName);
              if (u.tags.length === 0) delete u.tags;
            }
          });
          tags.splice(idx, 1);
        }
        break;
      }

      case 'updateUserGroups': {
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });
        if (
          isTargetPrivileged &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }

        const safeTags = validateGroupTags(userGroups, adminConfig);
        if (safeTags.length > 0) targetEntry.tags = safeTags;
        else delete targetEntry.tags;
        break;
      }

      case 'batchUpdateUserGroups': {
        if (usernames.length === 0)
          return NextResponse.json(
            { error: '缺少用户名列表' },
            { status: 400 },
          );

        const targetSet = new Set(usernames);

        // 1. Block Owner from being a target
        if (OWNER_USERNAME && targetSet.has(OWNER_USERNAME)) {
          return NextResponse.json(
            { error: '无法批量操作站长' },
            { status: 403 },
          );
        }

        // 2. Block Non-Owners from modifying Privileged Users
        if (operatorRole !== 'owner') {
          const hasPrivilegedTarget = adminConfig.UserConfig.Users.some(
            (u) =>
              targetSet.has(u.username) &&
              isPrivilegedUser(u) &&
              u.username !== username,
          );
          if (hasPrivilegedTarget)
            return NextResponse.json(
              { error: '无法批量操作包含管理员/站长的列表' },
              { status: 403 },
            );
        }

        const safeTags = validateGroupTags(userGroups, adminConfig);

        adminConfig.UserConfig.Users.forEach((u) => {
          if (targetSet.has(u.username)) {
            if (safeTags.length > 0) u.tags = safeTags;
            else delete u.tags;
          }
        });
        break;
      }

      case 'updateUserAdultFilter': {
        if (!targetEntry)
          return NextResponse.json({ error: '用户不存在' }, { status: 404 });
        if (
          isTargetPrivileged &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '权限不足' }, { status: 403 });
        }
        targetEntry.disableYellowFilter = disableYellowFilter;
        break;
      }

      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 6. Final Save
    if (!didSaveConfig && action !== 'changePassword') {
      await db.saveAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('User management operation failed:', error);
    return NextResponse.json(
      { error: '操作失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
