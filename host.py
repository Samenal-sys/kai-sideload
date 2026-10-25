#!/usr/bin/env python3
"""Serve a KaiOS packaged app and the update manifest AppsManager expects."""
# this was created by https://github.com/Garbagebuild 
from __future__ import annotations

import argparse
import hashlib
import json
import re
import socket
import sys
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit


MANIFEST_MIME = "application/x-web-app-manifest+json; charset=utf-8"


def package_namespace(package: Path, manifest: dict) -> str:
    """Return a stable, package-specific URL component.

    KaiOS associates an update URL with an installed app. Reusing one fixed
    /update.webmanifest URL for unrelated packages can cause
    REINSTALL_FORBIDDEN or name/origin conflicts.
    """
    slug = re.sub(
        r"[^a-z0-9]+", "-", str(manifest.get("name", "app")).lower()
    ).strip("-")
    digest = hashlib.sha256(package.read_bytes()).hexdigest()[:10]
    return f"{slug or 'app'}-{digest}"


def package_alias(manifest: dict, requested: Optional[str] = None) -> str:
    """Return a short, typeable URL alias such as ``pa``."""
    if requested:
        alias = re.sub(r"[^a-z0-9_-]+", "", requested.lower())
        if not alias:
            raise ValueError("--id must contain a letter or number")
        return alias[:16]
    words = re.findall(r"[a-z0-9]+", str(manifest.get("name", "app")).lower())
    if len(words) > 1:
        return "".join(word[0] for word in words)[:4]
    return (words[0][:4] if words else "app")


def read_package_manifest(package: Path) -> tuple[dict, str]:
    if not package.is_file():
        raise FileNotFoundError(f"Package not found: {package}")
    if not zipfile.is_zipfile(package):
        raise ValueError(f"Not a valid ZIP file: {package}")

    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
        manifest_name = next(
            (name for name in ("manifest.webmanifest", "manifest.webapp") if name in names),
            None,
        )
        if not manifest_name:
            nested = [
                name for name in names
                if name.endswith(("/manifest.webmanifest", "/manifest.webapp"))
            ]
            if nested:
                raise ValueError(
                    "The app manifest is inside a subdirectory. Rebuild application.zip "
                    "with manifest.webmanifest or manifest.webapp at the ZIP root."
                )
            raise ValueError(
                "application.zip needs manifest.webmanifest or manifest.webapp at its root."
            )
        try:
            manifest = json.loads(archive.read(manifest_name).decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(f"Invalid {manifest_name}: {error}") from error

    if not isinstance(manifest, dict) or not manifest.get("name"):
        raise ValueError(f"{manifest_name} must be a JSON object with a non-empty name.")
    return manifest, manifest_name


def has_kaios_signature_metadata(package: Path) -> bool:
    """Report signature metadata presence without claiming it is authentic."""
    with zipfile.ZipFile(package) as archive:
        names = {name.lower() for name in archive.namelist()}
    return {
        "meta-inf/manifest.mf",
        "meta-inf/zigbert.sf",
        "meta-inf/zigbert.rsa",
    }.issubset(names)


def package_features(manifest: dict, legacy: bool) -> dict | None:
    if not legacy:
        value = manifest.get("b2g_features")
        return value if isinstance(value, dict) else None

    features = {}
    for key in (
        "developer", "permissions", "default_locale", "locales", "activities",
        "messages", "inputs", "redirects", "serviceworker", "dependencies",
        "version",
    ):
        if key in manifest:
            features[key] = manifest[key]
    return features or None


def build_update_manifest(package: Path, manifest: dict, legacy: bool, base_url: str) -> dict:
    features = package_features(manifest, legacy)
    version = manifest.get("version")
    if not version and isinstance(features, dict):
        version = features.get("version")
    update = {
        "name": manifest["name"],
        "version": str(version or "1.0.0"),
        "package_path": f"{base_url}/application.zip",
        "packaged_size": package.stat().st_size,
        "size": package.stat().st_size,
        "type": str(manifest.get("type") or "web"),
    }
    if isinstance(features, dict):
        update["b2g_features"] = features
    dependencies = manifest.get("dependencies")
    if isinstance(dependencies, dict):
        update["dependencies"] = dependencies
    return update


def guess_lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))
        return sock.getsockname()[0]
    except OSError:
        return "YOUR-PC-IP"
    finally:
        sock.close()


def make_handler(package: Path, manifest: dict, legacy: bool, alias: Optional[str] = None):
    """Backward-compatible one-package handler used by existing callers."""
    return make_catalog_handler([{
        "package": package,
        "manifest": manifest,
        "legacy": legacy,
        "alias": package_alias(manifest, alias),
    }])


def make_catalog_handler(entries: list):
    if not entries:
        raise ValueError("At least one package is required")

    aliases = [entry["alias"] for entry in entries]
    if len(set(aliases)) != len(aliases):
        raise ValueError("Package aliases must be unique")

    class Handler(BaseHTTPRequestHandler):
        server_version = "JScalatedSideload/1.1"

        def log_message(self, fmt: str, *args) -> None:
            sys.stdout.write(f"{self.client_address[0]} - {fmt % args}\n")

        def common_headers(self, mime: str, length: int) -> None:
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(length))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")

        def send_bytes(self, status: int, mime: str, body: bytes, head_only: bool = False) -> None:
            self.send_response(status)
            self.common_headers(mime, len(body))
            self.end_headers()
            if not head_only:
                self.wfile.write(body)

        def base_url(self) -> str:
            host = self.headers.get("Host") or f"127.0.0.1:{self.server.server_port}"
            return f"http://{host}"

        def route(self, head_only: bool = False) -> None:
            path = urlsplit(self.path).path
            for entry in entries:
                package = entry["package"]
                manifest = entry["manifest"]
                legacy = entry["legacy"]
                short_prefix = "/" + entry["alias"]
                namespace_prefix = "/apps/" + package_namespace(package, manifest)
                manifest_paths = (
                    short_prefix,
                    short_prefix + "/update.webmanifest",
                    namespace_prefix + "/update.webmanifest",
                    namespace_prefix + "/manifest.webmanifest",
                )
                if path in manifest_paths:
                    selected_prefix = (
                        namespace_prefix if path.startswith("/apps/") else short_prefix
                    )
                    body = json.dumps(
                        build_update_manifest(
                            package,
                            manifest,
                            legacy,
                            self.base_url() + selected_prefix,
                        ),
                        ensure_ascii=False,
                        indent=2,
                    ).encode("utf-8")
                    self.send_bytes(200, MANIFEST_MIME, body, head_only)
                    return
                if path in (
                    short_prefix + "/application.zip",
                    namespace_prefix + "/application.zip",
                ):
                    self.send_bytes(
                        200, "application/zip", package.read_bytes(), head_only
                    )
                    return

            if len(entries) == 1 and path in (
                "/update.webmanifest", "/manifest.webmanifest"
            ):
                # Compatibility only. It must not be used for different apps.
                entry = entries[0]
                body = json.dumps(
                    build_update_manifest(
                        entry["package"],
                        entry["manifest"],
                        entry["legacy"],
                        self.base_url(),
                    ),
                    ensure_ascii=False,
                    indent=2,
                ).encode("utf-8")
                self.send_bytes(200, MANIFEST_MIME, body, head_only)
            elif len(entries) == 1 and path == "/application.zip":
                self.send_bytes(
                    200, "application/zip", entries[0]["package"].read_bytes(), head_only
                )
            elif path == "/health":
                self.send_bytes(200, "text/plain; charset=utf-8", b"JScalated sideload server OK\n", head_only)
            elif path == "/":
                lines = ["JScalated Sideload Server", "Available apps:"]
                for entry in entries:
                    lines.append(
                        "  /{}  {}".format(entry["alias"], entry["manifest"]["name"])
                    )
                body = ("\n".join(lines) + "\n").encode("utf-8")
                self.send_bytes(200, "text/plain; charset=utf-8", body, head_only)
            else:
                self.send_bytes(404, "text/plain; charset=utf-8", b"Not found\n", head_only)

        def do_GET(self) -> None:  # noqa: N802
            self.route(False)

        def do_HEAD(self) -> None:  # noqa: N802
            self.route(True)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Serve application.zip in the format KaiOS AppsManager.installPackage expects."
    )
    parser.add_argument(
        "packages",
        nargs="*",
        metavar="PACKAGE",
        help="one or more application ZIP files (default: application.zip)",
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument(
        "--id",
        dest="alias",
        help="short URL alias when serving one package; for example pa",
    )
    args = parser.parse_args()

    package_args = args.packages or ["application.zip"]
    if args.alias and len(package_args) != 1:
        parser.error("--id can only be used when serving one package")

    entries = []
    try:
        for package_arg in package_args:
            package = Path(package_arg).expanduser().resolve()
            manifest, manifest_name = read_package_manifest(package)
            base_alias = package_alias(manifest, args.alias)
            alias = base_alias
            suffix = 2
            while any(entry["alias"] == alias for entry in entries):
                alias = base_alias + str(suffix)
                suffix += 1
            entries.append({
                "package": package,
                "manifest": manifest,
                "manifest_name": manifest_name,
                "legacy": manifest_name == "manifest.webapp",
                "alias": alias,
                "sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
                "signature_metadata": has_kaios_signature_metadata(package),
            })
        handler = make_catalog_handler(entries)
    except (OSError, ValueError) as error:
        parser.error(str(error))

    lan_ip = guess_lan_ip()
    server = ThreadingHTTPServer((args.host, args.port), handler)

    print("JScalated Sideload Server")
    print("SECURITY WARNING:")
    print("  Affected KaiOS versions contain a production package-signature bypass.")
    print("  Device acceptance does not prove a package is authentic or safe.")
    print("  This helper does not cryptographically authenticate packages.")
    print("  Serve only packages you independently reviewed and trust.")
    print()
    print("Each app has a different install URL:")
    for entry in entries:
        print()
        print(f"  {entry['manifest']['name']}")
        print(f"    Package : {entry['package']}")
        print(f"    Manifest: {entry['manifest_name']}")
        print(f"    SHA-256 : {entry['sha256']}")
        print(
            "    Signature: {} (presence only; authenticity not verified)".format(
                "metadata present" if entry["signature_metadata"] else "metadata missing"
            )
        )
        print(f"    URL     : http://{lan_ip}:{args.port}/{entry['alias']}")
    print()
    print("Keep this window open. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
