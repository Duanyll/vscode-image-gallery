import * as vscode from 'vscode';
import TelemetryReporter, {
    TelemetryEventMeasurements, TelemetryEventProperties
} from '@vscode/extension-telemetry';
import * as utils from './utils';

export let reporter: ExtensionReporter;

export function activate(context: vscode.ExtensionContext) {
    reporter = new ExtensionReporter(context);
    context.subscriptions.push(reporter);
}

export function deactivate() {
    if (!reporter) { return; }
    reporter.dispose();
}

export class ExtensionReporter extends TelemetryReporter {
    constructor(
        context: vscode.ExtensionContext,
        public verbose = false, // true for development; false for production
        public readonly enableTelemetry: boolean = false, // telemetry disabled in this fork
        private readonly instrumentationKey = "",
    ) {
        super(instrumentationKey);
    }


    public sendTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties | undefined,
        measurements?: TelemetryEventMeasurements | undefined,
    ) {
        if (!this.enableTelemetry) { return; }
        if (this.verbose) {
            console.log(`Telemetry event: ${eventName}`, properties, measurements);
        }
        super.sendTelemetryEvent(eventName, properties, measurements);
    }
}
