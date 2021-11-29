import json

class BExtensionResult:
    def __init__(self):
        self.name = ''
        self.result = ''
    
    def toJSON1(self):
         return self.__dict__

    def toJSON2(self):
        return json.dumps(self, default=lambda o: o.__dict__, sort_keys=True, indent=4)