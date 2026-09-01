#!/usr/bin/env python3
"""Write unlocked computed rhythm/lead difficulty values directly to Turso."""

import argparse
import json
import sys

import libsql_experimental as libsql


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", required=True)
    parser.add_argument("--auth-token", required=True)
    parser.add_argument("--song-id", required=True, type=int)
    parser.add_argument("--rhythm", type=float)
    parser.add_argument("--lead", type=float)
    args = parser.parse_args()

    connection = None
    try:
        connection = libsql.connect(args.db_url, auth_token=args.auth_token)
        cursor = connection.cursor()
        cursor.execute(
            "SELECT rhythm_difficulty_manual, lead_difficulty_manual "
            "FROM song WHERE id = ?",
            (args.song_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"Song {args.song_id} was not found")

        rhythm_written = args.rhythm is not None and not bool(row[0])
        lead_written = args.lead is not None and not bool(row[1])

        if rhythm_written:
            cursor.execute(
                "UPDATE song SET rhythm_difficulty = ? WHERE id = ?",
                (args.rhythm, args.song_id),
            )
        if lead_written:
            cursor.execute(
                "UPDATE song SET lead_difficulty = ? WHERE id = ?",
                (args.lead, args.song_id),
            )
        if rhythm_written or lead_written:
            connection.commit()

        print(json.dumps({
            "rhythm_written": rhythm_written,
            "lead_written": lead_written,
        }))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
