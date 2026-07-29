from __future__ import annotations

import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", ROOT / "data" / "openui.db"))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS sessions_user_id_idx
            ON sessions(user_id);

            CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
            ON sessions(expires_at);

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS chats_user_updated_idx
            ON chats(user_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS messages_chat_position_idx
            ON messages(chat_id, position);

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                chunk_count INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS documents_user_created_idx
            ON documents(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS document_chunks_document_position_idx
            ON document_chunks(document_id, position);

            CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts
            USING fts5(chunk_id UNINDEXED, content, tokenize='unicode61');
            """
        )


def create_user(email: str, password_hash: str) -> dict[str, Any]:
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": password_hash,
        "created_at": int(time.time() * 1000),
    }
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO users (id, email, password_hash, created_at)
            VALUES (:id, :email, :password_hash, :created_at)
            """,
            user,
        )
    return user


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
            (email,),
        ).fetchone()
    return dict(row) if row else None


def create_session(token_hash: str, user_id: str, expires_at: int) -> None:
    now = int(time.time())
    with connect() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        connection.execute(
            """
            INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, user_id, expires_at, now),
        )


def get_user_by_session(token_hash: str) -> dict[str, Any] | None:
    now = int(time.time())
    with connect() as connection:
        row = connection.execute(
            """
            SELECT users.id, users.email, users.created_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
    return dict(row) if row else None


def delete_session(token_hash: str) -> None:
    with connect() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def _chat_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    messages = connection.execute(
        """
        SELECT id, role, content, created_at
        FROM messages
        WHERE chat_id = ?
        ORDER BY position ASC
        """,
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"],
        "title": row["title"],
        "model": row["model"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "messages": [
            {
                "id": message["id"],
                "role": message["role"],
                "content": message["content"],
                "createdAt": message["created_at"],
            }
            for message in messages
        ],
    }


def list_chats(user_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, title, model, created_at, updated_at
            FROM chats
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [_chat_from_row(connection, row) for row in rows]


def upsert_chat(user_id: str, chat: dict[str, Any]) -> None:
    with connect() as connection:
        owner = connection.execute(
            "SELECT user_id FROM chats WHERE id = ?",
            (chat["id"],),
        ).fetchone()
        if owner and owner["user_id"] != user_id:
            raise PermissionError("Chat belongs to another user.")

        connection.execute(
            """
            INSERT INTO chats (id, user_id, title, model, created_at, updated_at)
            VALUES (:id, :user_id, :title, :model, :created_at, :updated_at)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            {
                "id": chat["id"],
                "user_id": user_id,
                "title": chat["title"],
                "model": chat["model"],
                "created_at": chat["createdAt"],
                "updated_at": chat["updatedAt"],
            },
        )
        connection.execute("DELETE FROM messages WHERE chat_id = ?", (chat["id"],))
        connection.executemany(
            """
            INSERT INTO messages (id, chat_id, role, content, created_at, position)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    message["id"],
                    chat["id"],
                    message["role"],
                    message["content"],
                    message["createdAt"],
                    position,
                )
                for position, message in enumerate(chat["messages"])
            ],
        )


def delete_chat(user_id: str, chat_id: str) -> bool:
    with connect() as connection:
        cursor = connection.execute(
            "DELETE FROM chats WHERE id = ? AND user_id = ?",
            (chat_id, user_id),
        )
    return cursor.rowcount > 0


def create_document(
    user_id: str,
    filename: str,
    content_type: str,
    size_bytes: int,
    chunks: list[str],
) -> dict[str, Any]:
    document_id = str(uuid.uuid4())
    created_at = int(time.time() * 1000)
    chunk_rows = [
        (str(uuid.uuid4()), document_id, position, content)
        for position, content in enumerate(chunks)
    ]
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO documents (
                id, user_id, filename, content_type, size_bytes, chunk_count, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                user_id,
                filename,
                content_type,
                size_bytes,
                len(chunk_rows),
                created_at,
            ),
        )
        connection.executemany(
            """
            INSERT INTO document_chunks (id, document_id, position, content)
            VALUES (?, ?, ?, ?)
            """,
            chunk_rows,
        )
        connection.executemany(
            "INSERT INTO document_chunks_fts (chunk_id, content) VALUES (?, ?)",
            [(row[0], row[3]) for row in chunk_rows],
        )
    return {
        "id": document_id,
        "filename": filename,
        "contentType": content_type,
        "sizeBytes": size_bytes,
        "chunkCount": len(chunk_rows),
        "createdAt": created_at,
    }


def list_documents(user_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, filename, content_type, size_bytes, chunk_count, created_at
            FROM documents
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "filename": row["filename"],
            "contentType": row["content_type"],
            "sizeBytes": row["size_bytes"],
            "chunkCount": row["chunk_count"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def delete_document(user_id: str, document_id: str) -> bool:
    with connect() as connection:
        chunk_rows = connection.execute(
            """
            SELECT document_chunks.id
            FROM document_chunks
            JOIN documents ON documents.id = document_chunks.document_id
            WHERE documents.id = ? AND documents.user_id = ?
            """,
            (document_id, user_id),
        ).fetchall()
        if not chunk_rows:
            exists = connection.execute(
                "SELECT 1 FROM documents WHERE id = ? AND user_id = ?",
                (document_id, user_id),
            ).fetchone()
            if not exists:
                return False
        connection.executemany(
            "DELETE FROM document_chunks_fts WHERE chunk_id = ?",
            [(row["id"],) for row in chunk_rows],
        )
        connection.execute(
            "DELETE FROM documents WHERE id = ? AND user_id = ?",
            (document_id, user_id),
        )
    return True


def search_document_chunks(
    user_id: str,
    query: str,
    document_ids: list[str] | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    tokens = re.findall(r"[^\W_]{2,}", query.lower(), flags=re.UNICODE)[:16]
    if not tokens:
        return []

    match_query = " OR ".join(f'"{token}"' for token in tokens)
    params: list[Any] = [match_query, user_id]
    document_filter = ""
    if document_ids:
        placeholders = ",".join("?" for _ in document_ids)
        document_filter = f" AND documents.id IN ({placeholders})"
        params.extend(document_ids)
    params.append(max(1, min(limit, 10)))

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                document_chunks.id AS chunk_id,
                document_chunks.document_id,
                document_chunks.position,
                document_chunks.content,
                documents.filename,
                bm25(document_chunks_fts) AS rank
            FROM document_chunks_fts
            JOIN document_chunks
                ON document_chunks.id = document_chunks_fts.chunk_id
            JOIN documents
                ON documents.id = document_chunks.document_id
            WHERE document_chunks_fts MATCH ?
                AND documents.user_id = ?
                {document_filter}
            ORDER BY rank
            LIMIT ?
            """,
            params,
        ).fetchall()
    return [
        {
            "chunkId": row["chunk_id"],
            "documentId": row["document_id"],
            "filename": row["filename"],
            "position": row["position"],
            "content": row["content"],
        }
        for row in rows
    ]
