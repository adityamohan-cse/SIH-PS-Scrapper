import sys
import os

# Add the project root directory to Python's sys.path so server and scraper modules import properly
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from server import app

# Export app for Vercel Serverless Function
