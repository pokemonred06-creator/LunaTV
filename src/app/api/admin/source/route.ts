import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types'; // Assuming types are here, adjust if needed
import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// --- Types ---

type Action =
  | 'add'
  | 'disable'
  | 'enable'
  | 'delete'
  | 'batch_disable'
  | 'batch_enable'
  | 'batch_delete'
  | 'sort';

interface SourcePayload {
  action: Action;
  // Add
  key?: string;
  name?: string;
  api?: string;
  detail?: string;
  // Single Operation
  // key?: string; (Reused)
  // Batch Operation
  keys?: string[];
  // Sort
  order?: string[];
}

// --- Helpers ---

/**
 * Clean up permission references when a source is deleted.
 * Removes the source key from all Users and Tags 'enabledApis' lists.
 */
function removeSourcePermissions(config: AdminConfig, sourceKey: string) {
  // Clean Users
  config.UserConfig.Users.forEach((user) => {
    if (user.enabledApis) {
      user.enabledApis = user.enabledApis.filter((k) => k !== sourceKey);
    }
  });

  // Clean Tags (Groups)
  if (config.UserConfig.Tags) {
    config.UserConfig.Tags.forEach((tag) => {
      if (tag.enabledApis) {
        tag.enabledApis = tag.enabledApis.filter((k) => k !== sourceKey);
      }
    });
  }
}

// --- Main Handler ---

export async function POST(request: NextRequest) {
  try {
    const body: SourcePayload = await request.json();
    const { action } = body;

    // 1. Authentication
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Load Configuration
    const config = await getConfig();

    // 3. Authorization (Strict: Owner or Env Root User only)
    const isRoot = authInfo.username === process.env.USERNAME;
    const user = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username,
    );

    if (!isRoot) {
      // If not root env user, must be a valid 'owner' in DB and not banned
      if (!user || user.role !== 'owner' || user.banned) {
        return NextResponse.json(
          { error: '权限不足: 仅站长可管理源' },
          { status: 403 },
        );
      }
    }

    // 4. Action Handlers
    switch (action) {
      case 'add': {
        const { key, name, api, detail } = body;
        if (!key || !name || !api) {
          return NextResponse.json(
            { error: '缺少必要参数 (key, name, api)' },
            { status: 400 },
          );
        }

        // Check duplicate
        if (config.SourceConfig.some((s) => s.key === key)) {
          return NextResponse.json(
            { error: 'Source Key 已存在' },
            { status: 400 },
          );
        }

        config.SourceConfig.push({
          key,
          name,
          api,
          detail: detail || '',
          from: 'custom',
          disabled: false,
        });
        break;
      }

      case 'disable':
      case 'enable': {
        if (!body.key)
          return NextResponse.json({ error: 'Missing key' }, { status: 400 });

        const target = config.SourceConfig.find((s) => s.key === body.key);
        if (!target)
          return NextResponse.json(
            { error: 'Source not found' },
            { status: 404 },
          );

        target.disabled = action === 'disable';
        break;
      }

      case 'delete': {
        if (!body.key)
          return NextResponse.json({ error: 'Missing key' }, { status: 400 });

        const idx = config.SourceConfig.findIndex((s) => s.key === body.key);
        if (idx === -1)
          return NextResponse.json(
            { error: 'Source not found' },
            { status: 404 },
          );

        const target = config.SourceConfig[idx];
        if (target.from === 'config') {
          return NextResponse.json(
            { error: '系统内置源不可删除' },
            { status: 403 },
          );
        }

        // Delete and Clean permissions
        config.SourceConfig.splice(idx, 1);
        removeSourcePermissions(config, body.key);
        break;
      }

      case 'batch_disable':
      case 'batch_enable': {
        if (!Array.isArray(body.keys) || body.keys.length === 0) {
          return NextResponse.json(
            { error: 'Missing keys array' },
            { status: 400 },
          );
        }

        const isDisabled = action === 'batch_disable';
        body.keys.forEach((key) => {
          const target = config.SourceConfig.find((s) => s.key === key);
          if (target) target.disabled = isDisabled;
        });
        break;
      }

      case 'batch_delete': {
        if (!Array.isArray(body.keys) || body.keys.length === 0) {
          return NextResponse.json(
            { error: 'Missing keys array' },
            { status: 400 },
          );
        }

        // Filter out built-in sources safely
        const deletableKeys = body.keys.filter((key) => {
          const target = config.SourceConfig.find((s) => s.key === key);
          return target && target.from !== 'config';
        });

        if (deletableKeys.length === 0) {
          return NextResponse.json(
            { error: '没有可删除的自定义源' },
            { status: 400 },
          );
        }

        // Execute Batch Delete
        deletableKeys.forEach((key) => {
          const idx = config.SourceConfig.findIndex((s) => s.key === key);
          if (idx !== -1) {
            config.SourceConfig.splice(idx, 1);
            removeSourcePermissions(config, key);
          }
        });
        break;
      }

      case 'sort': {
        if (!Array.isArray(body.order)) {
          return NextResponse.json(
            { error: 'Order must be an array' },
            { status: 400 },
          );
        }

        const sourceMap = new Map(config.SourceConfig.map((s) => [s.key, s]));
        const newOrder: typeof config.SourceConfig = [];

        // 1. Add items in the requested order
        body.order.forEach((key) => {
          const item = sourceMap.get(key);
          if (item) {
            newOrder.push(item);
            sourceMap.delete(key);
          }
        });

        // 2. Append any items that were missing from the order array (safety)
        config.SourceConfig.forEach((item) => {
          if (sourceMap.has(item.key)) {
            newOrder.push(item);
          }
        });

        config.SourceConfig = newOrder;
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // 5. Persist Changes
    await db.saveAdminConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Source Action Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: (error as Error).message },
      { status: 500 },
    );
  }
}
