import inspect
import unittest

from alibabacloud_swas_open20200601 import models
from alibabacloud_swas_open20200601.client import Client


class AliyunSdkContractTests(unittest.TestCase):
    def test_required_sdk_calls_exist(self):
        self.assertTrue(hasattr(Client, "list_instances_with_options"))
        self.assertTrue(hasattr(Client, "describe_monitor_data_with_options"))
        self.assertTrue(hasattr(Client, "list_instances_traffic_packages_with_options"))

    def test_request_models_accept_expected_fields(self):
        params = inspect.signature(models.DescribeMonitorDataRequest).parameters
        for name in ("region_id", "instance_id", "metric_name", "period"):
            self.assertIn(name, params)


if __name__ == "__main__":
    unittest.main()
