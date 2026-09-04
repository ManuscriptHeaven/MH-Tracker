import type { TelemetryEvent } from './aiCrossModuleTypes';

export class CrossModuleTelemetry {
  private static instance: CrossModuleTelemetry;
  private logs: TelemetryEvent[] = [];

  public static getInstance(): CrossModuleTelemetry {
    if (!CrossModuleTelemetry.instance) {
      CrossModuleTelemetry.instance = new CrossModuleTelemetry();
    }
    return CrossModuleTelemetry.instance;
  }

  public recordEvent(event: Omit<TelemetryEvent, 'eventId' | 'timestamp'>): TelemetryEvent {
    const fullEvent: TelemetryEvent = {
      eventId: `tel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.logs.push(fullEvent);
    // Keep in-memory buffer limited to 500 recent events
    if (this.logs.length > 500) {
      this.logs.shift();
    }
    return fullEvent;
  }

  public getRecentLogs(limit = 50): TelemetryEvent[] {
    return [...this.logs].reverse().slice(0, limit);
  }

  public getSecurityAlerts(): TelemetryEvent[] {
    return this.logs.filter((l) => l.promptInjectionDetected || l.blockedWriteAttempt || !l.permissionChecksPassed);
  }
}
