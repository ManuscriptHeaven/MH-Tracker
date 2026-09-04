import type { AIActionPlan, ConfirmationToken, ConfirmationStatus } from './aiActionTypes';

export interface TokenValidationResult {
  valid: boolean;
  errorCode?: 'CONFIRMATION_EXPIRED' | 'CONFIRMATION_INVALID' | 'CONFIRMATION_REQUIRED';
  reason?: string;
}

export class ConfirmationEngine {
  private static instance: ConfirmationEngine;
  private pendingTokens: Map<string, ConfirmationToken> = new Map();
  private activePendingByActor: Map<string, ConfirmationToken> = new Map();

  public static getInstance(): ConfirmationEngine {
    if (!ConfirmationEngine.instance) {
      ConfirmationEngine.instance = new ConfirmationEngine();
    }
    return ConfirmationEngine.instance;
  }

  public hashParameters(actionTool: string, params: Record<string, any>): string {
    const keys = Object.keys(params).sort();
    const sortedObj: Record<string, any> = {};
    keys.forEach((k) => {
      sortedObj[k] = params[k];
    });
    return `${actionTool}:${JSON.stringify(sortedObj)}`;
  }

  public createConfirmationToken(
    actionPlan: AIActionPlan,
    actorId: string,
    userMessageContext?: string,
  ): ConfirmationToken {
    const tokenId = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    // 5-minute confirmation expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const parametersHash = this.hashParameters(actionPlan.actionTool, actionPlan.parameters);

    const token: ConfirmationToken = {
      tokenId,
      actionPlan,
      parametersHash,
      actorId,
      createdAt,
      expiresAt,
      status: 'pending',
      userMessageContext,
    };

    this.pendingTokens.set(tokenId, token);
    this.activePendingByActor.set(actorId, token);

    return token;
  }

  public getPendingTokenForActor(actorId: string): ConfirmationToken | undefined {
    const token = this.activePendingByActor.get(actorId);
    if (!token) return undefined;

    // Check expiry
    if (new Date().getTime() > new Date(token.expiresAt).getTime()) {
      token.status = 'expired';
      this.activePendingByActor.delete(actorId);
      return undefined;
    }
    return token;
  }

  public validateToken(
    token: ConfirmationToken,
    currentParams: Record<string, any>,
    actorId: string,
  ): TokenValidationResult {
    if (token.status !== 'pending') {
      return {
        valid: false,
        errorCode: 'CONFIRMATION_INVALID',
        reason: `Confirmation token status is ${token.status}.`,
      };
    }

    if (new Date().getTime() > new Date(token.expiresAt).getTime()) {
      token.status = 'expired';
      this.activePendingByActor.delete(actorId);
      return {
        valid: false,
        errorCode: 'CONFIRMATION_EXPIRED',
        reason: 'That action confirmation token has expired. Please confirm again.',
      };
    }

    if (token.actorId !== actorId) {
      return {
        valid: false,
        errorCode: 'CONFIRMATION_INVALID',
        reason: 'Action confirmation token actor mismatch.',
      };
    }

    const currentHash = this.hashParameters(token.actionPlan.actionTool, currentParams);
    if (currentHash !== token.parametersHash) {
      return {
        valid: false,
        errorCode: 'CONFIRMATION_INVALID',
        reason: 'Action parameters changed since initial confirmation. A new confirmation is required.',
      };
    }

    return { valid: true };
  }

  public confirmToken(tokenId: string, actorId: string): boolean {
    const token = this.pendingTokens.get(tokenId);
    if (token && token.status === 'pending' && token.actorId === actorId) {
      token.status = 'confirmed';
      this.activePendingByActor.delete(actorId);
      return true;
    }
    return false;
  }

  public cancelPendingToken(actorId: string): ConfirmationToken | undefined {
    const token = this.activePendingByActor.get(actorId);
    if (token) {
      token.status = 'cancelled';
      this.activePendingByActor.delete(actorId);
      return token;
    }
    return undefined;
  }

  public isCancellationRequest(userMessage: string): boolean {
    const text = (userMessage || '').trim().toLowerCase().replace(/[.!?,\u061B\u061F]+$/, '');
    const cancelKeywords = [
      'cancel',
      'cancel that',
      "don't do it",
      'dont do it',
      'stop',
      'abort',
      'nevermind',
      'nahi',
      'nahin',
      'rehne do',
      'rehne de',
      'kuch mat karo',
      'roko',
      'band karo',
      'منسوخ',
      'منسوخ کرو',
      'کینسل',
      'نہیں',
      'رہنے دو',
    ];

    return cancelKeywords.some((kw) => text === kw || text.startsWith(`${kw} `) || text.endsWith(` ${kw}`));
  }

  public clear(): void {
    this.pendingTokens.clear();
    this.activePendingByActor.clear();
  }
}
