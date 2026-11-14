import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def make_keys() -> tuple[str, str]:
    """A VAPID key pair as (public, private), both URL-safe base64, ready for the environment."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64(public), b64(private)


class Command(BaseCommand):
    help = "Make the key pair browser push needs. Paste the two lines into the api's environment variables. Run once; keep the private key secret."

    def handle(self, *args, **opts):
        public, private = make_keys()
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private}")
        self.stdout.write(self.style.WARNING("Changing these later signs every browser out of push, so keep them."))
