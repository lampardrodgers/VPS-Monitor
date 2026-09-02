import unittest

from vpsmonitor.util import bytes_from, deep_find, first_mapping_list


class UtilTests(unittest.TestCase):
    def test_bytes_from_explicit_unit(self):
        self.assertEqual(bytes_from("1.5 GiB"), 1610612736)

    def test_bytes_from_default_unit(self):
        self.assertEqual(bytes_from(2, "gib"), 2147483648)

    def test_deep_find_normalizes_names(self):
        value = {"data": {"TrafficPackageTotal": 123}}
        self.assertEqual(deep_find(value, ("traffic_package_total",)), 123)

    def test_first_mapping_list(self):
        value = {"data": {"instances": [{"id": 1}, {"id": 2}]}}
        self.assertEqual(first_mapping_list(value), [{"id": 1}, {"id": 2}])


if __name__ == "__main__":
    unittest.main()
