import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const rootDir = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return nextResolve(pathToFileURL(pathResolve(rootDir, 'node_modules/next/headers.js')).href, context);
  }
  if (specifier === 'next/server') {
    return nextResolve(pathToFileURL(pathResolve(rootDir, 'node_modules/next/server.js')).href, context);
  }
  if (specifier === 'next/navigation') {
    return nextResolve(pathToFileURL(pathResolve(rootDir, 'node_modules/next/navigation.js')).href, context);
  }

  if (specifier.startsWith('@/')) {
    let target = pathResolve(rootDir, specifier.slice(2));
    if (existsSync(target) && statSync(target).isDirectory()) {
      if (existsSync(pathResolve(target, 'index.ts'))) {
        target = pathResolve(target, 'index.ts');
      } else if (existsSync(pathResolve(target, 'index.js'))) {
        target = pathResolve(target, 'index.js');
      }
    } else if (!existsSync(target)) {
      if (existsSync(`${target}.ts`)) {
        target = `${target}.ts`;
      } else if (existsSync(`${target}.tsx`)) {
        target = `${target}.tsx`;
      } else if (existsSync(`${target}.js`)) {
        target = `${target}.js`;
      }
    }
    return nextResolve(pathToFileURL(target).href, context);
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (context.parentURL && context.parentURL.startsWith('file://')) {
      const parentPath = new URL(context.parentURL).pathname;
      const parentDir = parentPath.endsWith('/') || (existsSync(parentPath) && statSync(parentPath).isDirectory())
        ? parentPath
        : pathResolve(parentPath, '..');
      let target = pathResolve(parentDir, specifier);
      if (existsSync(target) && statSync(target).isDirectory()) {
        if (existsSync(pathResolve(target, 'index.ts'))) {
          target = pathResolve(target, 'index.ts');
        } else if (existsSync(pathResolve(target, 'index.js'))) {
          target = pathResolve(target, 'index.js');
        }
      } else if (!existsSync(target)) {
        if (existsSync(`${target}.ts`)) {
          target = `${target}.ts`;
        } else if (existsSync(`${target}.tsx`)) {
          target = `${target}.tsx`;
        } else if (existsSync(`${target}.js`)) {
          target = `${target}.js`;
        }
      }
      return nextResolve(pathToFileURL(target).href, context);
    }
  }

  return nextResolve(specifier, context);
}
