import { Typing } from "@saggitarius/typing";
import { Future } from "@saggitarius/future";
import { Package, PackageRegistry } from "@saggitarius/package";
import { Path } from "@saggitarius/path";
import { IDirectory, Mode } from "@saggitarius/filesystem";

export interface IModuleLoader {
    loadModule(path: string): Promise<Record<string, unknown>>;
}
export namespace IModuleLoader {
    export const Type = Typing.type<IModuleLoader>("@saggitarius/module-loader::IModuleLoader");
}

export interface ISourceLoader {
    loadSource(path: string): Promise<string>;
}
export namespace ISourceLoader {
    export const Type = Typing.type<ISourceLoader>("@saggitarius/module-loader::ISourceLoader");
}

export interface ISourceProcessor {
    processSource(source: string, path: string): Promise<string>;
}
export namespace ISourceProcessor {
    export const Type = Typing.type<ISourceProcessor>("@saggitarius/module-loader::ISourceProcessor");
}

export interface ICodeInvoker {
    invokeCode(source: string): Promise<Record<string, unknown>>;
}
export namespace ICodeInvoker {
    export const Type = Typing.type<ICodeInvoker>("@saggitarius/module-loader::ICodeInvoker");
}

export interface IPathResolver {
    resolve(path: string): Promise<string>;
    resolveSource(path: string): Promise<string>;
}
export namespace IPathResolver {
    export const Type = Typing.type<IPathResolver>("@saggitarius/module-loader::IPathResolver");
}

export interface IFileLoader {
    loadFile(path: string): Promise<string>;
}
export namespace IFileLoader {
    export const Type = Typing.type<IFileLoader>("@saggitarius/module-loader::IFileLoader");
}

@Typing.register("@saggitarius/mode-loader::FileSystemFileLoader")
export class FileSystemFileLoader {
    public constructor(
        private dir: IDirectory,
    ) {}
    
    public async loadFile(path: string): Promise<string> {
        const file = await this.dir.file(path, Mode.Read);
        const content = await file.read();
        return content.toString();
    }
}

@Typing.register("@saggitarius/module-loader::SourceLoader")
export class SourceLoader implements ISourceLoader {
    public constructor(
        private pathResolver?: IPathResolver,
        private fileLoader?: IFileLoader,
        private cache = new Map<string, Future<string>>(),
    ) {}

    public async loadSource(path: string): Promise<string> {
        debugger;
        try {
            const realPath = this.pathResolver ? await this.pathResolver.resolveSource(path) : path;
            if (!this.cache) {
                return this.loadSourceFile(realPath);
            }
            if (!this.cache.has(realPath)) {
                const future = new Future<string>();
                this.loadSourceFile(realPath).then(
                    (res) => future.set(res),
                    (err) => future.fail(err),
                );
                this.cache.set(realPath, future);
            }
            return this.cache.get(realPath);

        } catch (err) {
            const msg = err instanceof Error ? err.message : "" + err;
            throw new Error(`Could not load source ${path}: ${msg}`);
        }
    }

    private loadSourceFile(path: string): Promise<string> {
        debugger;
        if (!this.fileLoader) {
            return Promise.reject(Error("fileLoader is not defined"));
        }
        return this.fileLoader.loadFile(path);
    }
}

enum ModuleLoaderStrategy {
    Auto,
    Import,
    Require,
    Custom,
};

declare var require: (path: string) => Record<string, unknown>;

@Typing.register("@saggitarius/module-loader::ModuleLoader")
export class ModuleLoader implements IModuleLoader {
    private strategy?: ModuleLoaderStrategy = ModuleLoaderStrategy.Auto;

    public constructor(
        public customLoader?: IModuleLoader,
    ) {}

    public loadModule(path: string): Promise<Record<string, unknown>> {
        debugger;
        switch (this.strategy) {
            case ModuleLoaderStrategy.Auto:
            case ModuleLoaderStrategy.Import:
                return this.importModule(path)
            case ModuleLoaderStrategy.Require:
                return this.requireModule(path);
            case ModuleLoaderStrategy.Custom:
                return this.customLoadModule(path);
        }
        return Promise.reject(new Error("Unknown module load strategy"));
    }

    private importModule(path: string): Promise<Record<string, unknown>> {
        debugger;
        try {
            const module = import(path);
            if (this.strategy === ModuleLoaderStrategy.Auto) {
                this.strategy = ModuleLoaderStrategy.Import;
            }
            return module;
        } catch (err) {
            if (this.strategy === ModuleLoaderStrategy.Auto) {
                return this.requireModule(path);
            }
            throw err;
        }
    }

    private requireModule(path: string): Promise<Record<string, unknown>> {
        debugger;
        try {
            const module = require(path);
            if (this.strategy === ModuleLoaderStrategy.Auto) {
                this.strategy = ModuleLoaderStrategy.Require;
            }
            return Promise.resolve(module);  
        } catch (err) {
            if (!(err instanceof ReferenceError)) {
                if (this.strategy === ModuleLoaderStrategy.Auto) {
                    this.strategy = ModuleLoaderStrategy.Require;
                }
                return Promise.reject(err);
            }
            if (this.strategy === ModuleLoaderStrategy.Auto) {
                return this.customLoadModule(path);
            }
            throw err;
        }
    }

    private customLoadModule(path: string): Promise<Record<string, unknown>> {
        debugger;
        if (!this.customLoader) {
            return Promise.reject(new Error('customLoader is not defined'));
        }
        if (this.strategy === ModuleLoaderStrategy.Auto) {
            this.strategy = ModuleLoaderStrategy.Custom;
        }
        return this.customLoader.loadModule(path);
    }
}

@Typing.register("@saggitarius/module-loader::SourceModuleLoader")
export class SourceModuleLoader implements IModuleLoader {
    public constructor(
        private sourceLoader: ISourceLoader,
        private codeInvoker: ICodeInvoker,
        private sourceProcessor?: ISourceProcessor,
        private cache = new Map<string, Future<Record<string, unknown>>>(),
    ) {}

    public async loadModule(path: string): Promise<Record<string, unknown>> {
        debugger;
        if (!this.cache.has(path)) {
            const future = new Future<Record<string, unknown>>();
            this.cache.set(path, future);
            let source = this.sourceLoader.loadSource(path);
            if (this.sourceProcessor) {
                source = source.then((source) => this.sourceProcessor.processSource(source, path));
            }
            source.then((source) => this.codeInvoker.invokeCode(source))
                .then(
                    (res) => future.set(res),
                    (err) => future.fail(err),
                );
        }
        return this.cache.get(path);
    }
}

@Typing.register("@saggitarius/module-loader::CodeModuleLoader")
export class CodeModuleLoader implements IModuleLoader {
    public constructor(
        private pathResolver: IPathResolver,
        private fileLoader: IFileLoader,
        private codeInvoker: ICodeInvoker,
        private cache = new Map<string, Future<Record<string, unknown>>>(),
    ) {}

    public async loadModule(path: string): Promise<Record<string, unknown>> {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }
        const realPath = await this.pathResolver.resolve(path);
        if (this.cache.has(realPath)) {
            const cached = this.cache.get(realPath);
            this.cache.set(path, cached);
            return cached;
        }
        const future = new Future<Record<string, unknown>>();
        this.cache.set(path, future);
        this.cache.set(realPath, future);

        this.fileLoader.loadFile(realPath).then(
            (code) => this.codeInvoker.invokeCode(code)
        ).then(
            (res) => future.set(res),
            (err) => future.fail(err),
        );
        return future;
    }
}

@Typing.register("@saggitarius/module-loader::StaticPathResolver")
export class StaticPathResolver implements IPathResolver {
    public constructor(
        private map: PackageRegistry,
        private root: string = "",
    ) {}
    
    public async resolve(path: string): Promise<string> {
        debugger;
        const pkg = this.getPackage(path);
        return Path.join(this.root, pkg.path, pkg.component);
    }

    public async resolveSource(path: string): Promise<string> {
        debugger;
        const pkg = this.getPackage(path);
        if (pkg.distDir) {
            pkg.component = Path.relative(pkg.distDir, pkg.component);
        }
        if (pkg.srcDir) {
            pkg.component = Path.join(pkg.srcDir, pkg.component);
        }
        return Path.join(this.root, pkg.path, pkg.component) + ".ts";
    }

    private getPackage(module: string): Package & { component: string } {
        debugger;
        const origin = module;
        let path = "";
        
        while (module.length > 0) {
            if (this.map[module]) {
                return {
                    ...this.map[module], 
                    component: Path.normalize(path) || this.map[module].main || "index"
                };
            }
            let lastSlash = module.lastIndexOf(Path.separator);
            if (lastSlash === -1) {
                lastSlash = 0;
            }
            path = module.substring(lastSlash + 1) + (path ? Path.separator + path : path);
            module = module.substring(0, lastSlash);
        }
        throw new Error(`Could not resolve module ${origin}`);
    }
}

type DefineFn = (deps: string[], cb: (...args: unknown[]) => Record<string, unknown>) => void;
type RequireFn = (path: string) => Record<string, unknown>;
type ImportFn = (path: string) => Promise<Record<string, unknown>>;

class DependencyRequiredSignal {
    public constructor(
        public readonly path: string,
    ) {}
}

@Typing.register("@saggitarius/module-loader::FunctionCodeInvoker")
export class FunctionCodeInvoker implements ICodeInvoker {
    
    public constructor(
        public moduleLoader?: IModuleLoader,
        private modules = new Map<string, Record<string, unknown>>(),
    ) {}
    
    public async invokeCode(source: string): Promise<Record<string, unknown>> {
        debugger;
        const exports = {};
        const module = { exports };
        const asyncModule: { exports?: Future<Record<string, unknown>> } = {};

        await this.preload(source);
        source = this.preprocess(source);

        await this.invoke(
            source,
            module,
            exports,
            this.makeDefine(asyncModule),
            this.makeRequire(),
            this.makeImport(),
        );

        return asyncModule.exports
            ? asyncModule.exports
            : module.exports;
    }

    private async invoke(
        source: string,
        module: Record<string, unknown>, 
        exports: Record<string, unknown>,
        define: DefineFn,
        require: RequireFn,
        import_: ImportFn,
    ) {
        while (true) {
            try {
                const result = (new Function(
                    "module", "exports", "define",
                    "require", "import_",
                    source
                ))(module, exports, define, require, import_);
                if (result instanceof Promise) {
                    await result;
                }
                return;
            } catch (err) {
                if (err instanceof DependencyRequiredSignal) {
                    await this.waitForModules([err.path]);
                } else {
                    throw err;
                }
            }
        }
    }

    private makeDefine(asyncModule: { exports?: Future<Record<string, unknown>> }): DefineFn {
        return (deps: string[], cb: (...args: unknown[]) => Record<string, unknown>) => {
            asyncModule.exports = new Future();
            Promise.all(
                deps.map((dep) => this.loadModule(dep))
            ).then((deps) => {
                asyncModule.exports.set(cb(...deps));
            }).catch((err) => {
                asyncModule.exports.fail(err);
            });
        }
    }

    private makeRequire(): RequireFn {
        return (path: string): Record<string, unknown> => {
            if (!this.modules.has(path)) {
                throw new DependencyRequiredSignal(path);
            }
            return this.modules.get(path);
        };
    }

    private makeImport(): ImportFn {
        return (path: string): Promise<Record<string, unknown>> => {
            return this.loadModule(path);
        };
    }

    private preload(source: string): Promise<void> {
        const matches = source.matchAll(/(require|import)\s*\(\s*(".+?"|'.+?')\s*\)/g);
        const deps = [];
        for (const group of matches) {
            deps.push(group[2].substring(1, group[2].length));
        }
        return this.waitForModules(deps);
    }

    private preprocess(source: string): string {
        return source.replaceAll(/import(\s*\(.*?\))/g, "import_$1");
    }

    private waitForModules(deps: string[]): Promise<void> {
        deps = deps.filter((dep) => !this.modules.has(dep));
        if (deps.length === 0) {
            return Promise.resolve();
        }
        return Promise.all(
            deps.map((dep) => this.loadModule(dep))
        ).then(() => undefined);
    }

    private async loadModule(path: string): Promise<Record<string, unknown>> {
        if (!this.modules.has(path)) {
            if (!this.moduleLoader) {
                new Error("moduleLoader is undefined");
            }
            const module = await this.moduleLoader.loadModule(path);
            this.modules.set(path, module);
        }
        return this.modules.get(path);
    }
}