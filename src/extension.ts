import * as vscode from 'vscode';
import { ManifestEntry, ManifestIndex } from './manifestIndex';

const OPEN_MANIFEST_COMMAND = 'cppInlayLinks.openManifestEntry';
const SYMBOL_COMMENT = /^\s*\/\/\s*@symbol\s+([^\s]+)/;

/*
 * Provides inlay hints for C++ `@symbol` comments, allowing users to click on the inlay to navigate to the corresponding manifest entry.
*/
class SymbolInlayProvider implements vscode.InlayHintsProvider {
    readonly onDidChangeInlayHints: vscode.Event<void>;

    constructor(private readonly index: ManifestIndex) {
        this.onDidChangeInlayHints = index.onDidChange;
    }

    async provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): Promise<vscode.InlayHint[]> {
        const hints: vscode.InlayHint[] = [];
        const firstLine = Math.max(0, range.start.line);
        const lastLine = Math.min(document.lineCount - 1, range.end.line);

        for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
            if (token.isCancellationRequested) {
                return hints;
            }

            const line = document.lineAt(lineNumber);
            const match = SYMBOL_COMMENT.exec(line.text);
            if (match) {
                const symbol = match[1];
                const entry = await this.index.find(document, symbol);
                if (!entry || token.isCancellationRequested) {
                    continue;
                }

                const label = new vscode.InlayHintLabelPart(formatLabel(entry));
                label.tooltip = new vscode.MarkdownString(
                    `Open \`${entry.symbol}\` in \`${vscode.workspace.asRelativePath(entry.manifest)}\``
                );
                label.command = {
                    command: OPEN_MANIFEST_COMMAND,
                    title: 'Open TU manifest entry',
                    arguments: [entry.manifest, entry.selection]
                };

                const hint = new vscode.InlayHint(line.range.end, [label], vscode.InlayHintKind.Type);
                hint.paddingLeft = true;
                hints.push(hint);
            }
        }

        return hints;
    }
}

/*
    * Activates the extension, registering the inlay hints provider and the command to open manifest entries.
*/
export function activate(context: vscode.ExtensionContext): void {
    const index = new ManifestIndex();
    const provider = vscode.languages.registerInlayHintsProvider(
        { language: 'cpp', scheme: 'file' },
        new SymbolInlayProvider(index)
    );
    const navigation = vscode.commands.registerCommand(
        OPEN_MANIFEST_COMMAND,
        async (manifest: vscode.Uri, selection: vscode.Range) => {
            if (!(manifest instanceof vscode.Uri) || !(selection instanceof vscode.Range)) {
                return;
            }

            const document = await vscode.workspace.openTextDocument(manifest);
            const editor = await vscode.window.showTextDocument(document, {
                preview: true,
                selection
            });
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    );

    context.subscriptions.push(index, provider, navigation);
}

export function deactivate(): void {
    // VS Code disposes everything registered in the extension context.
}

/**
 * Formats the label for an inlay hint based on the manifest entry.
 * @param entry The manifest entry to format.
 * @returns The formatted label.
 */
function formatLabel(entry: ManifestEntry): string {
    const parts = [`ROM #${entry.ordinal}`];
    if (entry.address) {
        parts.push(entry.address);
    }
    if (entry.size) {
        parts.push(`size ${entry.size}`);
    }
    return parts.join(' · ');
}
