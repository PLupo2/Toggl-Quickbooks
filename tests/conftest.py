import os
import sys

SERVICE_DIR = os.path.join(os.path.dirname(__file__), "..", "service")
sys.path.insert(0, os.path.abspath(SERVICE_DIR))
