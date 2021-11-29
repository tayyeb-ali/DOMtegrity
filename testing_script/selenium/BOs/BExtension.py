import json

class BExtension:
    def __init__(self):
        name = ''
        producer = ''
        category = ''
        population = ''
        ratings = ''
        no_people_rated = ''
        status = ''
    
    def toJSON1(self):
         return self.__dict__

    def toJSON2(self):
        return json.dumps(self, default=lambda o: o.__dict__, sort_keys=True, indent=4)

with open('data.txt', 'w') as outfile:
    data = {}
    data['extensions'] = []
    be = BExtension()
    be.category = 'ddddd'
    data['extensions'].append(be.toJSON1())
    json.dump(data, outfile)



#print(be.name)