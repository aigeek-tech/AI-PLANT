from app.security import hash_password, hash_session_token, verify_password


def test_password_hash_verifies_original_password_only():
    password_hash = hash_password("correct-password")

    assert verify_password("correct-password", password_hash)
    assert not verify_password("wrong-password", password_hash)
    assert password_hash != "correct-password"


def test_session_hash_is_deterministic_and_not_raw_token():
    first = hash_session_token("raw-token")
    second = hash_session_token("raw-token")

    assert first == second
    assert first != "raw-token"

