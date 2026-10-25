#!/usr/bin/env python3
"""Build a KaiOS 3 signature *test fixture* from an unsigned application.zip.

This single file uses only Python's standard library. By default it uses
embedded metadata from the locally tested Store proof reference. --reference
selects a different signed application.zip. Neither mode owns the private key:
the CMS signature is copied, not recomputed, so the result is not genuinely
signed. A particular verifier/device may nevertheless accept it; test that
separately. This program neither installs apps nor contacts a device.

Usage:
  python signer-kaios-apps-standalone.py unsigned.zip
  python signer-kaios-apps-standalone.py unsigned.zip --output fixture.zip
  python signer-kaios-apps-standalone.py unsigned.zip --reference application.zip
"""
# this was created by https://github.com/Garbagebuild
from __future__ import annotations

import argparse
import base64
import hashlib
from pathlib import Path
import sys
import zipfile


SIGNATURE_MEMBERS = (
    "META-INF/zigbert.rsa", "META-INF/zigbert.sf", "META-INF/manifest.mf"
)
EMBEDDED_REFERENCE_SHA256 = "945af1f4628a5162be70ea8ce65d97c12d81c5f52c02dba5b21ada12d105f4ed"
# The following public CMS container and SF record are from that reference ZIP.
# They contain a certificate and signature, not a private signing key.
EMBEDDED_RSA_B64 = "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"
EMBEDDED_SF_B64 = "U2lnbmF0dXJlLVZlcnNpb246IDEuMA0KU0hBMS1EaWdlc3QtTWFuaWZlc3Q6IDNydittd1FvbDZlcjFlMnErTGVMbjhNNG1rWT0NCg0K"

SIGNED_DATA_OID = bytes.fromhex("2a864886f70d010702")
MESSAGE_DIGEST_OID = bytes.fromhex("2a864886f70d010904")
DIGEST_OIDS = {
    bytes.fromhex("2b0e03021a"): "sha1",
    bytes.fromhex("608648016503040201"): "sha256",
    bytes.fromhex("608648016503040202"): "sha384",
    bytes.fromhex("608648016503040203"): "sha512",
}


def der_item(data: bytes, offset: int, limit: int) -> tuple[int, int, int, int]:
    """Return tag, content start, content end, next offset for definite DER."""
    if offset + 2 > limit:
        raise ValueError("Truncated CMS DER")
    tag, first = data[offset], data[offset + 1]
    if tag & 31 == 31:
        raise ValueError("High-tag-number CMS DER is unsupported")
    cursor = offset + 2
    if first < 128:
        length = first
    else:
        count = first & 127
        if not count or count > 4 or cursor + count > limit:
            raise ValueError("Invalid CMS DER length")
        length = int.from_bytes(data[cursor:cursor + count], "big")
        if length < 128 or data[cursor] == 0:
            raise ValueError("Non-minimal CMS DER length")
        cursor += count
    end = cursor + length
    if end > limit:
        raise ValueError("CMS DER length exceeds container")
    return tag, cursor, end, end


def der_children(data: bytes, start: int, end: int) -> list[tuple[int, int, int, int]]:
    children = []
    cursor = start
    while cursor < end:
        child = der_item(data, cursor, end)
        children.append(child)
        cursor = child[3]
    return children


def require_tag(item: tuple[int, int, int, int], tag: int, label: str) -> None:
    if item[0] != tag:
        raise ValueError(f"Expected {label} in CMS DER")


def signer_fields(rsa: bytes) -> tuple[int, int, str, bytes]:
    """Locate one signer's signed messageDigest and unchanged signature bytes."""
    root = der_item(rsa, 0, len(rsa))
    require_tag(root, 0x30, "ContentInfo")
    if root[3] != len(rsa):
        raise ValueError("Trailing bytes after CMS ContentInfo")
    outer = der_children(rsa, root[1], root[2])
    if len(outer) != 2 or outer[0][0] != 0x06 or rsa[outer[0][1]:outer[0][2]] != SIGNED_DATA_OID:
        raise ValueError("CMS is not SignedData")
    require_tag(outer[1], 0xA0, "SignedData wrapper")
    wrapper = der_children(rsa, outer[1][1], outer[1][2])
    if len(wrapper) != 1:
        raise ValueError("Invalid SignedData wrapper")
    require_tag(wrapper[0], 0x30, "SignedData")
    fields = der_children(rsa, wrapper[0][1], wrapper[0][2])
    if len(fields) < 4:
        raise ValueError("Incomplete SignedData")
    require_tag(fields[-1], 0x31, "signerInfos")
    signers = der_children(rsa, fields[-1][1], fields[-1][2])
    if len(signers) != 1:
        raise ValueError(f"Expected one signer, found {len(signers)}")
    require_tag(signers[0], 0x30, "SignerInfo")
    signer = der_children(rsa, signers[0][1], signers[0][2])
    if len(signer) < 6:
        raise ValueError("Incomplete SignerInfo")
    require_tag(signer[2], 0x30, "digestAlgorithm")
    algorithm_fields = der_children(rsa, signer[2][1], signer[2][2])
    if not algorithm_fields or algorithm_fields[0][0] != 0x06:
        raise ValueError("Missing digest algorithm OID")
    algorithm = DIGEST_OIDS.get(rsa[algorithm_fields[0][1]:algorithm_fields[0][2]])
    if algorithm is None:
        raise ValueError("Unsupported CMS digest algorithm")
    require_tag(signer[3], 0xA0, "signedAttrs")
    attrs = der_children(rsa, signer[3][1], signer[3][2])
    digest_values = []
    for attr in attrs:
        require_tag(attr, 0x30, "signed attribute")
        parts = der_children(rsa, attr[1], attr[2])
        if len(parts) != 2 or parts[0][0] != 0x06:
            raise ValueError("Invalid signed attribute")
        if rsa[parts[0][1]:parts[0][2]] != MESSAGE_DIGEST_OID:
            continue
        require_tag(parts[1], 0x31, "messageDigest value set")
        values = der_children(rsa, parts[1][1], parts[1][2])
        if len(values) != 1:
            raise ValueError("Expected one messageDigest value")
        require_tag(values[0], 0x04, "messageDigest OCTET STRING")
        digest_values.append(values[0])
    if len(digest_values) != 1:
        raise ValueError(f"Expected one signed messageDigest, found {len(digest_values)}")
    require_tag(signer[5], 0x04, "CMS signature")
    value = digest_values[0]
    signature = rsa[signer[5][1]:signer[5][2]]
    return value[1], value[2], algorithm, signature


def load_zip(path: Path) -> tuple[list[tuple[zipfile.ZipInfo, bytes]], bytes]:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ValueError(f"ZIP has duplicate member names: {path}")
        if archive.testzip() is not None:
            raise ValueError(f"ZIP fails CRC integrity test: {path}")
        return [(info, archive.read(info)) for info in infos], archive.comment


def b64sha1(data: bytes) -> str:
    return base64.b64encode(hashlib.sha1(data).digest()).decode("ascii")


def build_manifest(files: list[tuple[zipfile.ZipInfo, bytes]]) -> bytes:
    lines = ["Manifest-Version: 1.0\r\n", "\r\n"]
    for info, data in files:
        name = info.filename
        if not name or ":" in name or "\r" in name or "\n" in name:
            raise ValueError(f"Unsupported ZIP member name: {name!r}")
        if name.startswith("/") or "\\" in name or any(part == ".." for part in name.split("/")):
            raise ValueError(f"Unsafe ZIP member path: {name!r}")
        lines.extend((f"Name: {name}\r\n", "Digest-Algorithms: SHA1\r\n",
                      f"SHA1-Digest: {b64sha1(data)}\r\n", "\r\n"))
    return "".join(lines).encode("utf-8")


def reference_metadata(path: Path | None) -> tuple[bytes, bytes, str]:
    if path is None:
        rsa = base64.b64decode(EMBEDDED_RSA_B64, validate=True)
        sf = base64.b64decode(EMBEDDED_SF_B64, validate=True)
        return rsa, sf, f"embedded proof reference SHA256 {EMBEDDED_REFERENCE_SHA256}"
    members, _ = load_zip(path)
    by_name = {info.filename: data for info, data in members}
    for name in SIGNATURE_MEMBERS:
        if name not in by_name:
            raise ValueError(f"Reference ZIP is missing {name}")
    return by_name[SIGNATURE_MEMBERS[0]], by_name[SIGNATURE_MEMBERS[1]], str(path)


def patch_cms_digest(rsa: bytes, old_sf: bytes, new_sf: bytes) -> tuple[bytes, str]:
    start, end, algorithm, old_signature = signer_fields(rsa)
    expected = hashlib.new(algorithm, old_sf).digest()
    if rsa[start:end] != expected:
        raise ValueError("Reference CMS messageDigest does not match zigbert.sf")
    new_digest = hashlib.new(algorithm, new_sf).digest()
    if new_digest == expected:
        raise ValueError("New signing-file digest unexpectedly matches reference")
    changed = rsa[:start] + new_digest + rsa[end:]
    check_start, check_end, check_algorithm, check_signature = signer_fields(changed)
    if (check_start, check_end, check_algorithm, check_signature) != (start, end, algorithm, old_signature):
        raise ValueError("Unexpected CMS mutation")
    return changed, algorithm


def generate(unsigned: Path, reference: Path | None, output: Path) -> tuple[str, str]:
    if unsigned.resolve() == output.resolve() or (reference and reference.resolve() == output.resolve()):
        raise ValueError("Output must not overwrite an input")
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")
    payload, comment = load_zip(unsigned)
    names = {info.filename for info, _ in payload}
    if any(name.upper().startswith(("META-INF/", "META-VEN/")) for name in names):
        raise ValueError("Input contains signing metadata; supply an unsigned application")
    if "manifest.webmanifest" not in names:
        raise ValueError("Input is missing manifest.webmanifest")
    rsa, sf, source = reference_metadata(reference)
    manifest_mf = build_manifest(payload)
    new_sf = ("Signature-Version: 1.0\r\n"
              f"SHA1-Digest-Manifest: {b64sha1(manifest_mf)}\r\n\r\n").encode("ascii")
    new_rsa, algorithm = patch_cms_digest(rsa, sf, new_sf)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for info, data in payload:
            archive.writestr(info, data)
        for name, data in zip(SIGNATURE_MEMBERS, (new_rsa, new_sf, manifest_mf)):
            archive.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
        archive.comment = comment
    contents, _ = load_zip(output)
    by_name = {info.filename: data for info, data in contents}
    if len(contents) != len(payload) + 3 or any(by_name[info.filename] != data for info, data in payload):
        raise AssertionError("Output did not preserve application payload")
    return algorithm, source


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("unsigned", type=Path, help="unsigned KaiOS 3 application.zip")
    parser.add_argument("--reference", type=Path, help="signed application.zip to use instead of embedded metadata")
    parser.add_argument("--output", type=Path, help="output ZIP (default: INPUT-signature-fixture.zip)")
    args = parser.parse_args(argv)
    output = args.output or args.unsigned.with_name(args.unsigned.stem + "-signature-fixture.zip")
    try:
        algorithm, source = generate(args.unsigned, args.reference, output)
        raw = output.read_bytes()
        print(f"Wrote: {output}")
        print(f"Size: {len(raw)} bytes; SHA256: {hashlib.sha256(raw).hexdigest()}")
        print(f"Metadata source: {source}; CMS digest algorithm: {algorithm}")
        print("CMS signature was copied, not recomputed: this is NOT an authentically signed app.")
        print("Check acceptance separately with the target verifier and device.")
        return 0
    except (ValueError, FileExistsError, FileNotFoundError, zipfile.BadZipFile, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
