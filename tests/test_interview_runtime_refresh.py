import unittest

from routes.interview.runtime import _needs_question_bank_refresh


class InterviewRuntimeRefreshTests(unittest.TestCase):
    def test_refresh_needed_when_stored_bank_is_smaller_than_required(self):
        self.assertTrue(_needs_question_bank_refresh([{"text": "Q1"}, {"text": "Q2"}], 8))

    def test_no_refresh_when_stored_bank_meets_required_size(self):
        self.assertFalse(_needs_question_bank_refresh([{"text": f"Q{i}"} for i in range(8)], 8))


if __name__ == "__main__":
    unittest.main()
