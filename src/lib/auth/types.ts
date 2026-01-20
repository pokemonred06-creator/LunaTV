export interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  timestamp?: number;
  signature?: string; // only present in server cookie
}

// Valid roles set for runtime validation
export const ROLE_SET = new Set<AuthInfo['role']>(['owner', 'admin', 'user']);
