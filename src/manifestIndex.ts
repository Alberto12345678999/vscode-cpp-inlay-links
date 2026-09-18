import * as vscode from 'vscode';

const MANIFEST_GLOB = '**/config/tu_manifest.d/**/*.json';

/*
    * Represents a function entry in a translation unit manifest.
*/
interface ManifestFunction {
    symbol?: unknown;
    address?: unknown;
    size?: unknown;
    ordinal?: unknown;
}

/*
    * Represents a translation unit manifest.
*/
interface TranslationUnitManifest {
    source?: unknown;
    promoted_source?: unknown;
    functions?: unknown;
}

/*
    * Command to open a manifest entry in the editor.
*/
export interface ManifestEntry {
    readonly symbol: string;
    readonly address?: string;
    readonly size?: string;
    readonly ordinal: number;
    readonly source: string;
    readonly manifest: vscode.Uri;
    readonly selection: vscode.Range;
}

/*
    * Represents the index of all manifest entries in the workspace.
*/
export class ManifestIndex implements vscode.Disposable {
    private readonly changedEmitter = new vscode.EventEmitter<void>();
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly subscriptions: vscode.Disposable[];
    private entries: Map<string, ManifestEntry> | undefined;
    private loading: Promise<Map<string, ManifestEntry>> | undefined;
    private revision = 0;

    readonly onDidChange = this.changedEmitter.event;

    constructor() {
        this.watcher = vscode.workspace.createFileSystemWatcher(MANIFEST_GLOB);
        this.subscriptions = [
            this.watcher,
            this.watcher.onDidCreate(() => this.invalidate()),
            this.watcher.onDidChange(() => this.invalidate()),
            this.watcher.onDidDelete(() => this.invalidate()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate())
        ];
    }

    async find(document: vscode.TextDocument, symbol: string): Promise<ManifestEntry | undefined> {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return undefined;
        }

        const source = normalizePath(vscode.workspace.asRelativePath(document.uri, false));
        const entries = await this.load();
        return entries.get(entryKey(folder.uri, source, symbol));
    }

    dispose(): void {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.changedEmitter.dispose();
    }

    private invalidate(): void {
        this.revision++;
        this.entries = undefined;
        this.loading = undefined;
        this.changedEmitter.fire();
    }

    private load(): Promise<Map<string, ManifestEntry>> {
        if (this.entries) {
            return Promise.resolve(this.entries);
        }

        if (!this.loading) {
            const revision = this.revision;
            this.loading = this.build().then(entries => {
                if (this.revision === revision) {
                    this.entries = entries;
                    this.loading = undefined;
                    this.changedEmitter.fire(); // Notify listeners (VS Code) that the index has changed after loading completes, otherwise after initial load the inlays won't show up until the next change.
                }
                return entries;
            }, error => {
                if (this.revision === revision) {
                    this.loading = undefined;
                }
                throw error;
            });
        }

        return this.loading;
    }

    private async build(): Promise<Map<string, ManifestEntry>> {
        const entries = new Map<string, ManifestEntry>();
        const manifests = await vscode.workspace.findFiles(
            MANIFEST_GLOB,
            '**/{.git,node_modules}/**'
        );

        await Promise.all(manifests.map(async manifestUri => {
            try {
                const bytes = await vscode.workspace.fs.readFile(manifestUri);
                const text = new TextDecoder('utf-8').decode(bytes);
                const manifest = JSON.parse(text) as TranslationUnitManifest;
                const folder = vscode.workspace.getWorkspaceFolder(manifestUri);
                const source = manifestSource(manifest);

                if (!folder || !source || !Array.isArray(manifest.functions)) {
                    return;
                }

                for (const candidate of manifest.functions as ManifestFunction[]) {
                    const entry = parseEntry(candidate, source, manifestUri, text);
                    if (entry) {
                        entries.set(entryKey(folder.uri, source, entry.symbol), entry);
                    }
                }
            } catch (error) {
                console.warn(`CPP Inlay Links: could not read ${manifestUri.fsPath}`, error);
            }
        }));

        return entries;
    }
}
/**
 * Extracts the source path from a translation unit manifest.
 * @param manifest The translation unit manifest.
 * @returns The source path, or undefined if it cannot be determined.
 */
function manifestSource(manifest: TranslationUnitManifest): string | undefined {
    const source = typeof manifest.promoted_source === 'string'
        ? manifest.promoted_source
        : manifest.source;
    return typeof source === 'string' ? normalizePath(source) : undefined;
}
/**
 * Parses a manifest function into a manifest entry.
 * @param candidate The manifest function to parse.
 * @param source The source path.
 * @param manifest The manifest URI.
 * @param manifestText The manifest text.
 * @returns The parsed manifest entry, or undefined if it cannot be parsed.
 */
function parseEntry(
    candidate: ManifestFunction,
    source: string,
    manifest: vscode.Uri,
    manifestText: string
): ManifestEntry | undefined {
    if (typeof candidate.symbol !== 'string' ||
        typeof candidate.ordinal !== 'number' ||
        !Number.isInteger(candidate.ordinal)) {
        return undefined;
    }

    const symbolText = JSON.stringify(candidate.symbol);
    const symbolOffset = findFunctionSymbolOffset(manifestText, symbolText);
    if (symbolOffset < 0) {
        return undefined;
    }

    const start = positionAt(manifestText, symbolOffset + 1);
    const end = positionAt(manifestText, symbolOffset + symbolText.length - 1);
    return {
        symbol: candidate.symbol,
        address: typeof candidate.address === 'string' ? candidate.address : undefined,
        size: typeof candidate.size === 'string' ? candidate.size : undefined,
        ordinal: candidate.ordinal,
        source,
        manifest,
        selection: new vscode.Range(start, end)
    };
}
/**
 * Finds the offset of a function's symbol in the manifest text.
 * @param manifestText The manifest text.
 * @param symbolText The symbol text.
 * @returns The offset of the symbol, or -1 if it is not found.
 */
function findFunctionSymbolOffset(manifestText: string, symbolText: string): number {
    const functionsOffset = manifestText.indexOf('"functions"');
    if (functionsOffset < 0) {
        return -1;
    }

    const escapedSymbol = symbolText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const property = new RegExp(`"symbol"\\s*:\\s*${escapedSymbol}`);
    const match = property.exec(manifestText.slice(functionsOffset));
    return match ? functionsOffset + match.index + match[0].lastIndexOf(symbolText) : -1;
}
/**
 * Generates a unique key for a manifest entry based on its workspace folder, source, and symbol.
 * @param workspaceFolder The workspace folder.
 * @param source The source path.
 * @param symbol The symbol.
 * @returns The generated key.
 */
function entryKey(workspaceFolder: vscode.Uri, source: string, symbol: string): string {
    return `${workspaceFolder.toString()}\0${normalizePath(source)}\0${symbol}`;
}
/**
 * Normalizes a path by replacing backslashes with forward slashes and removing the leading './'.
 * @param value Path of the string to normalize.
 * @returns The replaced string.
 */
function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}
/**
 * Returns the position of a character in a string.
 * @param text The string to search.
 * @param offset The offset of the character.
 * @returns The position of the character.
 */
function positionAt(text: string, offset: number): vscode.Position {
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\r?\n/);
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}
