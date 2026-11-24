"""Connection configuration regressions; no database server is required."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import model_db


class ConnectionSettingsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(model_db, 'ROOT', self.root).start()
        patch.dict(os.environ, {}, clear=True).start()

    def write_env(self, content):
        (self.root / '.env').write_text(content, encoding='utf-8')

    def test_server_defaults_are_preserved(self):
        os.environ['POSTGRES_PASSWORD'] = 'test-only'
        self.assertEqual(model_db.connection_options(), dict(host='127.0.0.1', port='5432',
            dbname='capstone', user='capstone', password='test-only'))

    def test_custom_database_and_environment_override(self):
        self.write_env('# 한글 설정\nPOSTGRES_HOST=db.example\nPOSTGRES_PORT=5433\n'
            'POSTGRES_DB=left_db\nPOSTGRES_USER=left\nPOSTGRES_PASSWORD=test-only\n')
        os.environ['POSTGRES_PORT'] = '55432'
        self.assertEqual(model_db.connection_options(), dict(host='db.example', port='55432',
            dbname='left_db', user='left', password='test-only'))

    def test_database_url_from_env_file(self):
        self.write_env('DATABASE_URL=postgresql://example/test\n')
        self.assertEqual(model_db.connection_options(), 'postgresql://example/test')

    def test_process_database_url_overrides_file(self):
        self.write_env('DATABASE_URL=postgresql://example/file\n')
        os.environ['DATABASE_URL'] = 'postgresql://example/process'
        self.assertEqual(model_db.connection_options(), 'postgresql://example/process')

    def test_missing_password_does_not_connect(self):
        with self.assertRaisesRegex(ValueError, 'DATABASE_URL'):
            model_db.connection_options()

    def test_registration_failure_closes_connection(self):
        os.environ['DATABASE_URL'] = 'postgresql://example/test'
        connection = Mock()
        driver = SimpleNamespace(connect=Mock(return_value=connection))
        adapter = SimpleNamespace(register_vector=Mock(side_effect=RuntimeError('extension unavailable')))
        with patch.dict(sys.modules, {'psycopg': driver, 'pgvector.psycopg': adapter}):
            with self.assertRaisesRegex(RuntimeError, 'extension unavailable'):
                model_db.connect()
        driver.connect.assert_called_once_with('postgresql://example/test', connect_timeout=5)
        connection.close.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
