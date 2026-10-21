from datetime import datetime, timedelta, timezone
from pathlib import Path
import ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

target = Path(__file__).resolve().parent.parent / 'work' / 'candidate-cert'
target.mkdir(parents=True, exist_ok=True)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
identity = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'FANU isolated localhost fixture')])
now = datetime.now(timezone.utc)
certificate = (x509.CertificateBuilder().subject_name(identity).issuer_name(identity)
    .public_key(key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=2))
    .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
    .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
    .sign(key, hashes.SHA256()))
(target / 'localhost-cert.pem').write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
(target / 'localhost-key.private.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
print('Generated a two-day certificate for the isolated loopback fixture only.')
