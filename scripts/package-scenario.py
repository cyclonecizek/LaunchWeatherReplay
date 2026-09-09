"""Build a conventional ZIP on disk, validate every entry, then publish atomically."""
import os
from pathlib import Path
import sys
import zipfile


def package(root: Path, destination: Path):
    paths = sorted(root.rglob('*'))
    files = [p for p in paths if p.is_file()]
    if any(p.is_symlink() for p in paths):
        raise ValueError('Links are not allowed in a GR package')
    if not files or not (root / 'README.txt').is_file():
        raise ValueError('Package is missing its instructions')
    if any(p.suffix.lower() == '.csv' or 'raw' in p.relative_to(root).parts for p in files):
        raise ValueError('Raw CSVs must not be included in a GR package')
    if sum(p.stat().st_size for p in files) > 2_000_000_000:
        raise ValueError('GR package exceeds 2 GB; split the scenario')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.zip.part')
    try:
        # Under 2 GB, so traditional ZIP headers suffice for Mac and Windows extractors.
        with zipfile.ZipFile(temporary, 'w', allowZip64=False) as archive:
            for path in files:
                relative = path.relative_to(root)
                method = zipfile.ZIP_STORED if relative.parts[0] == 'radar' else zipfile.ZIP_DEFLATED
                archive.write(path, (Path(root.name) / relative).as_posix(), compress_type=method, compresslevel=6)
        with zipfile.ZipFile(temporary) as archive:
            bad = archive.testzip()
            if bad is not None:
                raise ValueError(f'ZIP integrity failed: {bad}')
            expected = {(Path(root.name) / p.relative_to(root)).as_posix(): p.stat().st_size for p in files}
            actual = {info.filename: info.file_size for info in archive.infolist()}
            if expected != actual:
                raise ValueError('ZIP contents do not match the finished scenario')
        os.replace(temporary, destination)
        print(f'Validated ZIP: {destination.name} ({destination.stat().st_size:,} bytes)')
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    package(Path(sys.argv[1]), Path(sys.argv[2]))
