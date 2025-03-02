import * as fs from 'fs';
import _ from 'lodash';
import * as _path from 'path';
import { DependencyPointer } from '../domain';

function isRealElmPaths(sourceDir: string, filePath: String): boolean {
    const modulePath = filePath.replace(_path.normalize(sourceDir + '/'), '');
    const moduleParts = modulePath.split('/');
    return _.every(moduleParts, m => m.match('^[A-Z].*'));
}

function includedInFileSet(path: string): boolean {
    if (!path.match(/\.elm$/)) {
        return false;
    }

    return path.indexOf('elm-stuff') === -1 && path.indexOf('node_modules') === -1;
}

interface ElmPackage {
    'source-directories': string[];
    'exposed-modules': string[] | { [key: string]: string[] };
}

function getAllFilesInDirSync(pattern: RegExp, dir: string): string[] {
  function getFiles(curDir: string, files: string[]): string[] {
    return fs
      .readdirSync(curDir)
      .map(file => {
        const name = _path.join(curDir, file);
        const isDir = fs.statSync(name).isDirectory();
        const matchesPattern = pattern.test(file);

        return isDir ? getFiles(name, files) :
                       matchesPattern ? [name] : [];
      })
      .reduce((acc, val) => acc.concat(val), []);
  }

  return getFiles(dir, []);
}

function targetFilesForPathAndPackage(directory: string, path: string, pack: ElmPackage): string[] {
    const packTargetDirs: string[] = pack['source-directories'] || ['src'];
    const targetFiles = _.uniq(
        _.flatten(
            packTargetDirs.map(x => {
                const sourceDir = _path.normalize(path + '/' + x);
                const exists = fs.existsSync(sourceDir);
                if (!exists) {
                    return [];
                }

                const dirFiles = getAllFilesInDirSync(/\.elm$/, sourceDir).filter(x => {
                    const resolvedX = _path.resolve(x);
                    const resolvedPath = _path.resolve(path);
                    const relativePath = resolvedX.replace(resolvedPath, '');
                    return includedInFileSet(relativePath) && x.length > 0;
                });

                return dirFiles.filter(x => isRealElmPaths(sourceDir, x));
            })
        )
    ).map(function(s) {
        const sParts = s.split(_path.sep);
        const dirParts = directory.split(_path.sep);

        while (sParts.length > 0 && dirParts.length > 0) {
            if (sParts[0] == dirParts[0]) {
                sParts.shift();
                dirParts.shift();
            } else {
                break;
            }
        }

        const result = dirParts.map(() => '../').join('') + sParts.join('/');
        return _path.normalize(result);
    });
    return targetFiles;
}

function getDependencyFiles(directory: string, dep: DependencyPointer) {
    const depPath = `${directory}/elm-stuff/packages/${dep.name}/${dep.version}`;
    const depPackageFile: ElmPackage = require(depPath + '/elm.json');
    const unfilteredTargetFiles: string[] = targetFilesForPathAndPackage(directory, depPath, depPackageFile);
    const rawExposedModules = depPackageFile['exposed-modules'];

    const moduleNameToPath = (x: string) => _path.normalize('/' + x.replace(new RegExp('\\.', 'g'), '/') + '.elm');
    const exposedModules: string[] = rawExposedModules instanceof Array ?
        rawExposedModules.map(moduleNameToPath)
      : Object.keys(rawExposedModules)
          .reduce((prev, cur) => prev.concat((rawExposedModules as any)[cur]), [])
          .map(moduleNameToPath);

    return unfilteredTargetFiles.filter(x => exposedModules.filter(e => _.endsWith(x, e))[0]);
}

function gather(directory: string): { interfaceFiles: Array<string[]>; sourceFiles: string[] } {
    const packageFile = require(directory + '/elm.json');

    const input = {
        interfaceFiles: [],
        sourceFiles: targetFilesForPathAndPackage(directory, directory, packageFile)
    };
    return input;
}

export { gather, getDependencyFiles, includedInFileSet };
